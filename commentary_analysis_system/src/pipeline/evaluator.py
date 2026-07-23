def compute_metrics(y_true: list[int], y_pred: list[int]) -> dict:
    true_positive = 0
    false_positive = 0
    false_negative = 0
    true_negative = 0

    for true_label, pred_label in zip(y_true, y_pred):
        if true_label == 1 and pred_label == 1:
            true_positive += 1
        elif true_label == 0 and pred_label == 1:
            false_positive += 1
        elif true_label == 1 and pred_label == 0:
            false_negative += 1
        elif true_label == 0 and pred_label == 0:
            true_negative += 1

    precision = true_positive / (true_positive + false_positive) if (true_positive + false_positive) > 0 else 0.0
    recall = true_positive / (true_positive + false_negative) if (true_positive + false_negative) > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "precision": round(precision, 2),
        "recall": round(recall, 2),
        "f1": round(f1, 2)
    }

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

def print_evaluation_table(eval_results: dict):
    print(f"{'Method':<15} | {'Precision':<10} | {'Recall':<10} | {'F1':<10}")
    print("-" * 55)
    for method, metrics in eval_results.items():
        print(f"{method:<15} | {metrics['precision']:<10} | {metrics['recall']:<10} | {metrics['f1']:<10}")
