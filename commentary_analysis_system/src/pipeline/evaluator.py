
def compute_multiclass_metrics(y_true: list[str], y_pred: list[str]) -> dict:
    classes = set(y_true + y_pred)
    if "normal_play" in classes:
        classes.remove("normal_play")
        
    if not classes:
        return {"precision": 0.0, "recall": 0.0, "f1": 0.0}
        
    macro_p, macro_r, macro_f1 = 0.0, 0.0, 0.0
    
    for cls in classes:
        tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == cls and yp == cls)
        fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt != cls and yp == cls)
        fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == cls and yp != cls)
        
        p = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        r = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * p * r / (p + r) if (p + r) > 0 else 0.0
        
        macro_p += p
        macro_r += r
        macro_f1 += f1
        
    num_classes = len(classes)
    
    return {
        "precision": round(macro_p / num_classes, 2),
        "recall": round(macro_r / num_classes, 2),
        "f1": round(macro_f1 / num_classes, 2)
    }

def compute_regression_metrics(y_true: list[float], y_pred: list[float]) -> dict:
    if not y_true or not y_pred:
        return {"mse": 0.0, "mae": 0.0}
        
    n = len(y_true)
    mse = sum((t - p) ** 2 for t, p in zip(y_true, y_pred)) / n
    mae = sum(abs(t - p) for t, p in zip(y_true, y_pred)) / n
    
    return {
        "mse": round(mse, 4),
        "mae": round(mae, 4)
    }

def print_classification_table(eval_results: dict):
    print(f"\n--- Event Detection (Classification) ---")
    print(f"{'Method':<30} | {'Precision':<10} | {'Recall':<10} | {'F1':<10}")
    print("-" * 70)
    for method, metrics in eval_results.items():
        if "precision" in metrics:
            print(f"{method:<30} | {metrics['precision']:<10} | {metrics['recall']:<10} | {metrics['f1']:<10}")

def print_regression_table(eval_results: dict):
    print(f"\n--- Highlight Scoring (Regression) ---")
    print(f"{'Method':<30} | {'MSE':<10} | {'MAE':<10}")
    print("-" * 55)
    for method, metrics in eval_results.items():
        if "mse" in metrics:
            print(f"{method:<30} | {metrics['mse']:<10} | {metrics['mae']:<10}")
