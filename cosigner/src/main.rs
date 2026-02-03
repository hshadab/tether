use actix_governor::{Governor, GovernorConfigBuilder};
use actix_web::{web, App, HttpResponse, HttpServer};
use ark_bn254::Fr;
use ark_serialize::CanonicalDeserialize;
use jolt_core::{poly::commitment::dory::DoryCommitmentScheme, transcripts::KeccakTranscript};
use k256::ecdsa::{signature::Signer, SigningKey};
use onnx_tracer::{model, ProgramIO};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

/// Jolt lookup table size (2^14 = 16384 entries).
/// Must match the prover's table size for proof compatibility.
const JOLT_TABLE_SIZE: usize = 1 << 14;
use tiny_keccak::{Hasher, Keccak};
use zkml_jolt_core::jolt::{JoltSNARK, JoltVerifierPreprocessing};

#[allow(clippy::upper_case_acronyms)]
type PCS = DoryCommitmentScheme;

#[derive(Deserialize)]
struct VerifyRequest {
    proof: String,      // hex-encoded serialized proof
    program_io: String, // JSON-serialized ProgramIO
    tx: TxDetails,
    model_hash: String, // SHA256 of the ONNX model used by prover
}

#[derive(Deserialize, Clone)]
struct TxDetails {
    to: String,
    amount: String,
    token: String,
}

#[derive(Serialize)]
struct VerifyResponse {
    approved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nonce: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

/// Persistent nonce state backed by a JSON file.
/// Uses a simple counter - any nonce <= counter is implicitly "used".
#[derive(Serialize, Deserialize)]
struct NonceState {
    counter: u64,
    #[serde(skip)]
    path: String,
}

impl NonceState {
    fn load(path: &str) -> Self {
        if let Ok(mut f) = File::open(path) {
            let mut contents = String::new();
            if f.read_to_string(&mut contents).is_ok() {
                if let Ok(mut state) = serde_json::from_str::<NonceState>(&contents) {
                    state.path = path.to_string();
                    return state;
                }
            }
        }
        NonceState {
            counter: 0,
            path: path.to_string(),
        }
    }

    fn save(&self) -> std::io::Result<()> {
        let json = serde_json::to_string(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let mut f = File::create(&self.path)?;
        f.write_all(json.as_bytes())?;
        Ok(())
    }

    fn next_nonce(&mut self) -> u64 {
        self.counter += 1;
        if let Err(e) = self.save() {
            log::error!("Failed to persist nonce state: {e}");
        }
        self.counter
    }
}

struct AppState {
    verifier_preprocessing: JoltVerifierPreprocessing<Fr, PCS>,
    signing_key: SigningKey,
    nonce_state: Mutex<NonceState>,
    model_hash: String,
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak::v256();
    let mut output = [0u8; 32];
    hasher.update(data);
    hasher.finalize(&mut output);
    output
}

/// Compute SHA256 hash of a file, returned as hex string.
fn sha256_file(path: &str) -> Result<String, Box<dyn std::error::Error>> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

async fn verify_proof(data: web::Data<AppState>, req: web::Json<VerifyRequest>) -> HttpResponse {
    // 0. Check model hash matches
    if req.model_hash != data.model_hash {
        return HttpResponse::BadRequest().json(VerifyResponse {
            approved: false,
            signature: None,
            nonce: None,
            timestamp: None,
            reason: Some(format!(
                "Model hash mismatch: prover={}, cosigner={}",
                req.model_hash, data.model_hash
            )),
        });
    }

    // 1. Deserialize proof
    let proof_bytes = match hex::decode(&req.proof) {
        Ok(b) => b,
        Err(e) => {
            return HttpResponse::BadRequest().json(VerifyResponse {
                approved: false,
                signature: None,
                nonce: None,
                timestamp: None,
                reason: Some(format!("Invalid proof hex: {e}")),
            });
        }
    };

    let snark = match JoltSNARK::<Fr, PCS, KeccakTranscript>::deserialize_compressed(
        proof_bytes.as_slice(),
    ) {
        Ok(s) => s,
        Err(e) => {
            return HttpResponse::BadRequest().json(VerifyResponse {
                approved: false,
                signature: None,
                nonce: None,
                timestamp: None,
                reason: Some(format!("Failed to deserialize proof: {e}")),
            });
        }
    };

    // 2. Deserialize program_io
    let program_io: ProgramIO = match serde_json::from_str(&req.program_io) {
        Ok(p) => p,
        Err(e) => {
            return HttpResponse::BadRequest().json(VerifyResponse {
                approved: false,
                signature: None,
                nonce: None,
                timestamp: None,
                reason: Some(format!("Failed to deserialize program_io: {e}")),
            });
        }
    };

    // 3. Check output indicates AUTHORIZED (class 0 has highest value)
    // NOTE: ProgramIO contains fixed-point i32 values after Jolt circuit execution,
    // so integer cmp is correct here. The ONNX model originally outputs floats, but
    // those are converted to fixed-point integers during circuit execution.
    let output_data: Vec<i32> = program_io.output.iter().cloned().collect();
    if output_data.is_empty() {
        return HttpResponse::Forbidden().json(VerifyResponse {
            approved: false,
            signature: None,
            nonce: None,
            timestamp: None,
            reason: Some("Empty model output".to_string()),
        });
    }
    let (pred_idx, _) = output_data
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.cmp(b.1))
        .unwrap(); // safe: checked non-empty above
    if pred_idx != 0 {
        return HttpResponse::Forbidden().json(VerifyResponse {
            approved: false,
            signature: None,
            nonce: None,
            timestamp: None,
            reason: Some("Model output is DENIED (class != 0)".to_string()),
        });
    }

    // 4. Verify the SNARK proof
    log::info!("Verifying SNARK proof...");
    let verify_start = std::time::Instant::now();
    if let Err(e) = snark.verify(&data.verifier_preprocessing, program_io, None) {
        return HttpResponse::Forbidden().json(VerifyResponse {
            approved: false,
            signature: None,
            nonce: None,
            timestamp: None,
            reason: Some(format!("Proof verification failed: {e}")),
        });
    }
    log::info!("Proof verified in {:?}", verify_start.elapsed());

    // 5. Generate nonce and sign approval
    let nonce = {
        let mut state = data.nonce_state.lock().unwrap_or_else(|e| e.into_inner());
        state.next_nonce()
    };

    // Include timestamp for signature expiration
    // NOTE: The client/contract should reject signatures older than a configurable
    // threshold (e.g., 300 seconds) to prevent replay of stale approvals.
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Sign: keccak256(to || amount || token || nonce || timestamp)
    let mut msg = Vec::new();
    msg.extend_from_slice(req.tx.to.as_bytes());
    msg.extend_from_slice(req.tx.amount.as_bytes());
    msg.extend_from_slice(req.tx.token.as_bytes());
    msg.extend_from_slice(&nonce.to_be_bytes());
    msg.extend_from_slice(&timestamp.to_be_bytes());
    let hash = keccak256(&msg);

    let (sig, _) = data.signing_key.sign(&hash);
    let sig_hex = hex::encode(sig.to_bytes());

    HttpResponse::Ok().json(VerifyResponse {
        approved: true,
        signature: Some(sig_hex),
        nonce: Some(nonce),
        timestamp: Some(timestamp),
        reason: None,
    })
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"status": "ok"}))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();

    // Parse signing key first so we fail fast before expensive model preprocessing
    let cosigner_key_hex =
        std::env::var("COSIGNER_PRIVATE_KEY").expect("COSIGNER_PRIVATE_KEY env var must be set");
    let key_bytes = hex::decode(&cosigner_key_hex).expect("Invalid COSIGNER_PRIVATE_KEY hex");
    let signing_key =
        SigningKey::from_bytes((&key_bytes[..]).into()).expect("Invalid secp256k1 private key");

    let models_dir = std::env::var("MODELS_DIR").unwrap_or_else(|_| {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir.parent().expect("Failed to get repo root");
        format!("{}/models", repo_root.display())
    });
    let model_path = format!("{models_dir}/authorization.onnx");

    let model_hash = sha256_file(&model_path).expect("Failed to compute model hash");
    log::info!("Model SHA256: {model_hash}");

    let nonce_state_path =
        std::env::var("NONCE_STATE_PATH").unwrap_or_else(|_| "./nonce_state.json".to_string());
    let nonce_state = NonceState::load(&nonce_state_path);
    log::info!("Loaded nonce state (counter={})", nonce_state.counter);

    log::info!("Preprocessing authorization model for verifier...");
    let model_fn = || model(&PathBuf::from(&model_path));
    let preprocessing =
        JoltSNARK::<Fr, PCS, KeccakTranscript>::prover_preprocess(model_fn, JOLT_TABLE_SIZE);
    let verifier_preprocessing: JoltVerifierPreprocessing<Fr, PCS> = (&preprocessing).into();
    log::info!("Verifier preprocessing ready");

    let state = web::Data::new(AppState {
        verifier_preprocessing,
        signing_key,
        nonce_state: Mutex::new(nonce_state),
        model_hash,
    });

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    log::info!("Starting co-signer service on port {port}");

    // Rate limit: 10 requests per minute per IP
    let governor_conf = GovernorConfigBuilder::default()
        .seconds_per_request(6)
        .burst_size(10)
        .finish()
        .expect("Failed to build rate limiter config");

    // Configure JSON payload limit (default is 32KB, proof is ~110KB)
    let json_config = web::JsonConfig::default()
        .limit(512 * 1024) // 512KB limit
        .error_handler(|err, _req| {
            actix_web::error::InternalError::from_response(
                err,
                HttpResponse::BadRequest().json(VerifyResponse {
                    approved: false,
                    signature: None,
                    nonce: None,
                    timestamp: None,
                    reason: Some("JSON payload error".to_string()),
                }),
            )
            .into()
        });

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .app_data(json_config.clone())
            .route("/health", web::get().to(health))
            .route(
                "/verify",
                web::post()
                    .to(verify_proof)
                    .wrap(Governor::new(&governor_conf)),
            )
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keccak256_known_input() {
        // keccak256("") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
        let hash = keccak256(b"");
        assert_eq!(
            hex::encode(hash),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
    }

    #[test]
    fn test_keccak256_hello() {
        // keccak256("hello") known value
        let hash = keccak256(b"hello");
        assert_eq!(
            hex::encode(hash),
            "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
        );
    }

    #[test]
    fn test_argmax_class_0_wins() {
        let output_data: Vec<i32> = vec![100, 50, 30];
        let (pred_idx, _) = output_data
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.cmp(b.1))
            .unwrap();
        assert_eq!(pred_idx, 0);
    }

    #[test]
    fn test_argmax_class_1_wins() {
        let output_data: Vec<i32> = vec![10, 200, 30];
        let (pred_idx, _) = output_data
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.cmp(b.1))
            .unwrap();
        assert_eq!(pred_idx, 1);
    }

    #[test]
    fn test_argmax_empty() {
        let output_data: Vec<i32> = vec![];
        let result = output_data.iter().enumerate().max_by(|a, b| a.1.cmp(b.1));
        assert!(result.is_none());
    }

    #[test]
    fn test_nonce_state_persistence() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_nonce_state.json");
        let path_str = path.to_str().unwrap();

        // Clean up
        let _ = std::fs::remove_file(path_str);

        let mut state = NonceState::load(path_str);
        assert_eq!(state.counter, 0);

        let n1 = state.next_nonce();
        assert_eq!(n1, 1);

        let n2 = state.next_nonce();
        assert_eq!(n2, 2);

        // Reload from file - counter should be preserved
        let reloaded = NonceState::load(path_str);
        assert_eq!(reloaded.counter, 2);

        let _ = std::fs::remove_file(path_str);
    }
}
