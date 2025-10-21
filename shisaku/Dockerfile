FROM python:3.11-slim

WORKDIR /app

# ffmpegをインストール
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg

# 必要なパッケージをインストール
COPY requirements.txt .
COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir -r backend/requirements.txt

# ソースコードをコピー
COPY . .

# FastAPIを起動（uvicorn）
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
