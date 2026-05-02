# Use an Node-bundled Ubuntu Image natively compatible with FFmpeg & PyTorch constraints
FROM ubuntu:22.04

# Avoid apt configuration prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Update system dependencies optimally
RUN apt-get update && \
    apt-get install -y \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Setup unified container root Directory
WORKDIR /app

# Strategically isolate and inject python dependencies first to cache heavy whisper layers
COPY commentary_analysis_system/requirements.txt /app/commentary_analysis_system/
RUN pip3 install --no-cache-dir -r /app/commentary_analysis_system/requirements.txt

# Integrate the monorepo logic directly
COPY . /app/

# Navigate to frontend package handling to compile the JS layer
WORKDIR /app/frontend
# Install all node dependencies and output the optimized NextJS bundle
RUN npm install
RUN npm run build

# Provide fallback variable for Node environment injection scripts so python3 executes cross-platform automatically
ENV PYTHON_EXEC=python3

# Export standard port for proxy listeners
EXPOSE 3000

# Fire the optimized next start
CMD ["npm", "start"]
