FROM python:3.13-slim

# Prevent Python from buffering stdout/stderr and writing .pyc files
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Set the working directory inside the container
WORKDIR /app

# Copy dependency file and install dependencies (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application source code and init script
COPY app/ ./app
COPY client/ ./client
COPY init_db.py .

# Create data directory for persistent SQLite storage
RUN mkdir -p /app/data

# Expose the API port
EXPOSE 8000

# Start Uvicorn binding to all interfaces
CMD ["sh", "-c", "python init_db.py && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
