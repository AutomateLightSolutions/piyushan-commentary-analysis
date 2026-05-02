import path from "path";

/**
 * Dynamically resolves the correct python executable path.
 * 
 * When deployed via Docker or running natively on Linux, it defaults to the system "python3"
 * command so it runs out-of-the-box.
 * When running natively on Windows via npm uncontainerized, it accurately mounts 
 * to the '.venv/Scripts/python.exe' directory to prevent execution crashes.
 */
export function getPythonCommand(systemPath) {
    if (process.env.PYTHON_EXEC) {
        return process.env.PYTHON_EXEC;
    }
    
    const isWindows = process.platform === "win32";
    if (isWindows) {
        return path.resolve(systemPath, "..", ".venv", "Scripts", "python.exe");
    }

    // Default to the global available package within Docker/Linux deployment
    return "python3";
}
