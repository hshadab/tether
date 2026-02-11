use ark_bn254::Fr;
use ark_serialize::CanonicalSerialize;
use jolt_core::{poly::commitment::dory::DoryCommitmentScheme, transcripts::KeccakTranscript};
use onnx_tracer::{model, tensor::Tensor};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};
use zkml_jolt_core::jolt::JoltSNARK;

/// Jolt lookup table size (2^14 = 16384 entries).
/// Must match the cosigner's table size for proof compatibility.
const JOLT_TABLE_SIZE: usize = 1 << 14;

#[allow(clippy::upper_case_acronyms)]
type PCS = DoryCommitmentScheme;

#[derive(Deserialize)]
struct InputFeatures {
    budget: usize,
    trust: usize,
    amount: usize,
    category: usize,
    velocity: usize,
    day: usize,
    time: usize,
}

#[derive(Serialize)]
struct ProverOutput {
    proof: String,
    program_io: String,
    decision: String,
    model_hash: String,
}

fn load_vocab(path: &str) -> Result<HashMap<String, usize>, Box<dyn std::error::Error>> {
    let mut file = File::open(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    let json_value: serde_json::Value = serde_json::from_str(&contents)?;
    let mut vocab = HashMap::new();
    if let Some(serde_json::Value::Object(map)) = json_value.get("vocab_mapping") {
        for (feature_key, data) in map {
            if let Some(index) = data.get("index").and_then(|v| v.as_u64()) {
                vocab.insert(feature_key.clone(), index as usize);
            }
        }
    }
    Ok(vocab)
}

fn build_input_vector(features: &InputFeatures, vocab: &HashMap<String, usize>) -> Vec<i32> {
    let mut vec = vec![0; 64];
    let feature_values = [
        ("budget", features.budget),
        ("trust", features.trust),
        ("amount", features.amount),
        ("category", features.category),
        ("velocity", features.velocity),
        ("day", features.day),
        ("time", features.time),
    ];
    for (feature_type, value) in feature_values {
        let feature_key = format!("{feature_type}_{value}");
        if let Some(&index) = vocab.get(&feature_key) {
            if index < 64 {
                vec[index] = 1 << 7; // scale=7: represent 1.0 as 128 in fixed-point
            }
        }
    }
    vec
}

/// Validate that all feature values are within valid ranges matching models/vocab.json.
fn validate_features(features: &InputFeatures) -> Result<(), String> {
    let checks: [(&str, usize, usize); 7] = [
        ("budget", features.budget, 15),
        ("trust", features.trust, 7),
        ("amount", features.amount, 15),
        ("category", features.category, 3),
        ("velocity", features.velocity, 7),
        ("day", features.day, 7),
        ("time", features.time, 3),
    ];
    for (name, val, max) in checks {
        if val > max {
            return Err(format!(
                "Feature '{name}' value {val} out of range (0..={max})"
            ));
        }
    }
    Ok(())
}

/// Compute SHA256 hash of a file, returned as hex string.
// NOTE: Duplicate of sha256_file in cosigner/src/main.rs.
// Workspace extraction deferred because jolt-atlas path deps make shared crates complex.
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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();

    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        log::error!("Usage: zkml-prover '<json features>'");
        std::process::exit(1);
    }

    let features: InputFeatures = serde_json::from_str(&args[1])?;
    validate_features(&features)?;

    // Resolve paths relative to the binary or use MODELS_DIR env
    let models_dir = std::env::var("MODELS_DIR").unwrap_or_else(|_| {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir.parent().expect("Failed to get repo root");
        format!("{}/models", repo_root.display())
    });
    let vocab_path = format!("{models_dir}/vocab.json");
    let model_path = format!("{models_dir}/authorization.onnx");

    let model_hash = sha256_file(&model_path)?;

    let vocab = load_vocab(&vocab_path)?;
    let input_vector = build_input_vector(&features, &vocab);
    let input = Tensor::new(Some(&input_vector), &[1, 64])
        .map_err(|e| format!("Failed to create tensor: {e}"))?;

    // Run inference first to get decision
    // NOTE: The ONNX model outputs float values. partial_cmp is used here because
    // the raw inference result contains floats. In the cosigner, ProgramIO contains
    // fixed-point i32 values after Jolt circuit execution, so integer cmp is correct there.
    let model_fn = || model(&PathBuf::from(&model_path));
    let model_instance = model_fn();
    let result = model_instance
        .forward(&[input.clone()])
        .map_err(|e| format!("Model forward pass failed: {e}"))?;
    let output = result.outputs[0].clone();
    let (pred_idx, _) = output
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .ok_or("Empty model output")?;
    let decision = if pred_idx == 0 {
        "AUTHORIZED"
    } else {
        "DENIED"
    };

    if decision == "DENIED" {
        let out = ProverOutput {
            proof: String::new(),
            program_io: String::new(),
            decision: "DENIED".to_string(),
            model_hash,
        };
        println!("{}", serde_json::to_string(&out)?);
        return Ok(());
    }

    // Generate proof for authorized transactions
    log::info!("Preprocessing model...");
    let preprocessing =
        JoltSNARK::<Fr, PCS, KeccakTranscript>::prover_preprocess(model_fn, JOLT_TABLE_SIZE);

    log::info!("Generating proof...");
    let start = std::time::Instant::now();
    let (snark, program_io, _) =
        JoltSNARK::<Fr, PCS, KeccakTranscript>::prove(&preprocessing, model_fn, &input);
    log::info!("Proof generated in {:?}", start.elapsed());

    // Serialize proof
    let mut proof_bytes = Vec::new();
    snark.serialize_compressed(&mut proof_bytes)?;
    let proof_hex = hex::encode(&proof_bytes);

    // Serialize program_io
    let program_io_json = serde_json::to_string(&program_io)?;

    let out = ProverOutput {
        proof: proof_hex,
        program_io: program_io_json,
        decision: "AUTHORIZED".to_string(),
        model_hash,
    };
    println!("{}", serde_json::to_string(&out)?);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_input_vector_known_vocab() {
        let mut vocab = HashMap::new();
        vocab.insert("budget_10".to_string(), 0);
        vocab.insert("trust_5".to_string(), 3);

        let features = InputFeatures {
            budget: 10,
            trust: 5,
            amount: 0,
            category: 0,
            velocity: 0,
            day: 0,
            time: 0,
        };

        let vec = build_input_vector(&features, &vocab);
        assert_eq!(vec[0], 128); // 1 << 7
        assert_eq!(vec[3], 128);
        // All others zero
        assert_eq!(vec[1], 0);
        assert_eq!(vec[2], 0);
    }

    #[test]
    fn test_build_input_vector_missing_vocab_keys() {
        let vocab = HashMap::new(); // empty vocab

        let features = InputFeatures {
            budget: 10,
            trust: 5,
            amount: 3,
            category: 1,
            velocity: 2,
            day: 1,
            time: 1,
        };

        let vec = build_input_vector(&features, &vocab);
        assert!(
            vec.iter().all(|&v| v == 0),
            "All values should be zero with empty vocab"
        );
    }

    #[test]
    fn test_load_vocab_inline() {
        use std::io::Write;
        let dir = std::env::temp_dir();
        let path = dir.join("test_vocab.json");
        let mut f = File::create(&path).unwrap();
        write!(
            f,
            r#"{{"vocab_mapping": {{"budget_10": {{"index": 0}}, "trust_5": {{"index": 3}}}}}}"#
        )
        .unwrap();

        let vocab = load_vocab(path.to_str().unwrap()).unwrap();
        assert_eq!(vocab.get("budget_10"), Some(&0));
        assert_eq!(vocab.get("trust_5"), Some(&3));
        assert_eq!(vocab.len(), 2);
    }

    #[test]
    fn test_validate_features_valid() {
        let f = InputFeatures {
            budget: 15,
            trust: 7,
            amount: 8,
            category: 0,
            velocity: 2,
            day: 1,
            time: 1,
        };
        assert!(validate_features(&f).is_ok());
    }

    #[test]
    fn test_validate_features_out_of_range() {
        let f = InputFeatures {
            budget: 16,
            trust: 7,
            amount: 8,
            category: 0,
            velocity: 2,
            day: 1,
            time: 1,
        };
        assert!(validate_features(&f).is_err());
    }

    #[test]
    fn test_validate_features_category_boundary() {
        // category=3 is the max valid value
        let ok = InputFeatures {
            budget: 0,
            trust: 0,
            amount: 0,
            category: 3,
            velocity: 0,
            day: 0,
            time: 0,
        };
        assert!(validate_features(&ok).is_ok());

        // category=4 should fail
        let bad = InputFeatures {
            budget: 0,
            trust: 0,
            amount: 0,
            category: 4,
            velocity: 0,
            day: 0,
            time: 0,
        };
        assert!(validate_features(&bad).is_err());
    }

    #[test]
    fn test_validate_features_time_boundary() {
        // time=3 is the max valid value
        let ok = InputFeatures {
            budget: 0,
            trust: 0,
            amount: 0,
            category: 0,
            velocity: 0,
            day: 0,
            time: 3,
        };
        assert!(validate_features(&ok).is_ok());

        // time=4 should fail
        let bad = InputFeatures {
            budget: 0,
            trust: 0,
            amount: 0,
            category: 0,
            velocity: 0,
            day: 0,
            time: 4,
        };
        assert!(validate_features(&bad).is_err());
    }

    #[test]
    fn test_validate_features_all_at_max() {
        let f = InputFeatures {
            budget: 15,
            trust: 7,
            amount: 15,
            category: 3,
            velocity: 7,
            day: 7,
            time: 3,
        };
        assert!(validate_features(&f).is_ok());
    }
}
