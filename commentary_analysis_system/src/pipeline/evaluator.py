
def compute_multiclass_metrics(y_true: list[str], y_pred: list[str], all_classes: list[str] = None) -> dict:
    """
    Accuracy plus macro-averaged precision/recall/f1 over ALL classes,
    including normal_play - matches Colab's
    precision_recall_fscore_support(average="macro") / classification_report
    semantics exactly, so these numbers are directly comparable to the Colab
    evaluation notebook's precision_macro/recall_macro/f1_macro.

    Pass all_classes (the full configured event list) to average over a
    FIXED class set - matching sklearn's `labels=` behavior, and what
    Colab's own classification_report uses. Without it, the class set is
    inferred as whatever appears in y_true/y_pred for THIS match, which
    means a model that scatters false positives across many different
    wrong classes gets an inflated denominator (each noisy class drags the
    average down as its own near-zero-precision "class"), and the result
    isn't comparable across matches/methods since the denominator itself
    changes.

    Returns full-precision floats (no intermediate rounding) - round only
    at the point of display/export so per-match numbers aren't degraded
    before being averaged across matches.
    """
    if all_classes is not None:
        classes = list(all_classes)
    else:
        classes = sorted(set(y_true) | set(y_pred))

    total = len(y_true)
    accuracy = (
        sum(1 for yt, yp in zip(y_true, y_pred) if yt == yp) / total
        if total > 0 else 0.0
    )

    if not classes:
        return {"accuracy": accuracy, "precision": 0.0, "recall": 0.0, "f1": 0.0}

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
        "accuracy": accuracy,
        "precision": macro_p / num_classes,
        "recall": macro_r / num_classes,
        "f1": macro_f1 / num_classes,
    }

def compute_per_class_metrics(y_true: list[str], y_pred: list[str], all_classes: list[str]) -> dict:
    """
    Precision/recall/f1/support for EVERY class in all_classes, including
    normal_play - unlike compute_multiclass_metrics, which macro-averages
    all classes into one aggregate number. Classes with zero true
    occurrences in this match still get a row (support=0) so a table built
    from this stays a consistent, complete shape across different
    matches/models being compared.

    Returns full-precision floats (no intermediate rounding) - round only
    at the point of display/export.
    """
    result = {}
    for cls in all_classes:
        tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == cls and yp == cls)
        fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt != cls and yp == cls)
        fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == cls and yp != cls)
        support = sum(1 for yt in y_true if yt == cls)

        p = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        r = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * p * r / (p + r) if (p + r) > 0 else 0.0

        result[cls] = {
            "precision": p,
            "recall": r,
            "f1": f1,
            "support": support,
        }
    return result

def compute_regression_metrics(y_true: list[float], y_pred: list[float]) -> dict:
    if not y_true or not y_pred:
        return {"mse": 0.0, "mae": 0.0}

    n = len(y_true)
    mse = sum((t - p) ** 2 for t, p in zip(y_true, y_pred)) / n
    mae = sum(abs(t - p) for t, p in zip(y_true, y_pred)) / n

    return {
        "mse": mse,
        "mae": mae,
    }

def print_classification_table(eval_results: dict):
    print("\n--- Event Detection (Classification) ---")
    print(f"{'Method':<30} | {'Accuracy':<10} | {'Precision':<10} | {'Recall':<10} | {'F1':<10}")
    print("-" * 82)
    for method, metrics in eval_results.items():
        if "precision" in metrics:
            print(
                f"{method:<30} | {metrics.get('accuracy', 0.0):<10.2f} | "
                f"{metrics['precision']:<10.2f} | {metrics['recall']:<10.2f} | {metrics['f1']:<10.2f}"
            )

def print_regression_table(eval_results: dict):
    print("\n--- Highlight Scoring (Regression) ---")
    print(f"{'Method':<30} | {'MSE':<10} | {'MAE':<10}")
    print("-" * 55)
    for method, metrics in eval_results.items():
        if "mse" in metrics:
            print(f"{method:<30} | {metrics['mse']:<10.4f} | {metrics['mae']:<10.4f}")

def print_per_class_table(per_class_results: dict, title: str = "Per-Event Breakdown"):
    print(f"\n--- {title} ---")
    print(f"{'Event':<20} | {'Precision':<10} | {'Recall':<10} | {'F1':<10} | {'Support':<8}")
    print("-" * 70)
    for cls, m in per_class_results.items():
        print(f"{cls:<20} | {m['precision']:<10.2f} | {m['recall']:<10.2f} | {m['f1']:<10.2f} | {m['support']:<8}")
