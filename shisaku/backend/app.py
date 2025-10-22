# app.py — COEIROINK v2 専用・完全版 + オートモード(感情推定でTTS最適化)
import os
import sys
import threading
import platform
import subprocess
import time
import uuid
import json
import random
import math
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

import requests
import psutil
import speech_recognition as sr
from fastapi import FastAPI, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from google import genai
from pydub import AudioSegment

# ==========================
# 基本設定とパス
# ==========================
BASE_DIR = Path(__file__).resolve().parent
FRONT_DIR = BASE_DIR.parent / "frontend"
OUT_DIR = BASE_DIR.parent / "outputs" / "tts"
LOG_DIR = BASE_DIR.parent / "outputs"
LOG_FILE = LOG_DIR / "server.log"
OUT_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

def _log(msg: str):
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(msg.rstrip() + "\n")
    except Exception:
        pass

# --------------------------
# small util: sentence split
# --------------------------
_SENT_END = {"。", "！", "？", ".", "!", "?", "．"}


def _split_sentences(accum: str) -> Tuple[List[str], str]:
    """Split accum by Japanese/Latin sentence terminators, keeping the terminator.
    Returns (complete_sentences, remainder).
    """
    if not accum:
        return [], ""
    out: List[str] = []
    start = 0
    for i, ch in enumerate(accum):
        if ch in _SENT_END:
            seg = accum[start:i + 1].strip()
            if seg:
                out.append(seg)
            start = i + 1
    remainder = accum[start:].lstrip()
    return out, remainder

# ==========================
# 環境変数
# ==========================
# Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY が未設定です")

# COEIROINK
COEIROINK_URL = os.getenv("COEIROINK_URL", "http://127.0.0.1:50032").rstrip("/")
ENV_SPEAKER_UUID = os.getenv("COEIROINK_SPEAKER_UUID", "")
ENV_STYLE_ID = os.getenv("COEIROINK_STYLE_ID")
COEIROINK_STYLE_NAME = os.getenv("COEIROINK_STYLE_NAME")

# 背景LLM（Gemma via Ollama）設定
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")

# ==========================
# Gemini クライアント
# ==========================
client = genai.Client(api_key=GEMINI_API_KEY)
system_instruction = """あなたは私専用の会話パートナーです。
- 関西弁は禁止
- 語尾に「〜よ〜」「〜な〜」は禁止
- コメント挟まず、自然でフレンドリーなトーン
- しんみり禁止、明るくテンポよく
- コミカル寄り、柔らかい口調
- 長文すぎず、空白も多用しないで
- です・ます調で話すのは禁止
- 「あら」は禁止
- 一人称は「わたし」
"""
history = [system_instruction]

# 会話履歴は直近10往復（20メッセージ）だけを参照に使う
HISTORY_TURNS = 10  # 往復数

# ==========================
# FastAPI
# ==========================
app = FastAPI(title="AI Avatar Backend (COEIROINK v2 + Auto TTS)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================
# Webからの終了（必要ならログを開く）
# ==========================
@app.get("/api/exit")
def shutdown(show_log: int = Query(0, ge=0, le=1)):
    def _shutdown():
        import time
        time.sleep(0.4)

        # The original code had Windows-specific logic to kill parent shells
        # and open log files. This is replaced with a simple exit.
        print("Shutting down server...")
        os._exit(0)

    threading.Thread(target=_shutdown, daemon=True).start()
    return {"status": "shutting down"}

# 起動時に styleId / speakerUuid を決めておく
RESOLVED_STYLE_ID: Optional[int] = None
RESOLVED_SPEAKER_UUID: Optional[str] = None
CACHED_SPEAKERS: Optional[list] = None

# 手動モードのデフォルトTTS
DEFAULT_TTS = {
    "speedScale": 1.0,
    "volumeScale": 1.0,
    "pitchScale": 0.0,
    "intonationScale": 1.0,
    "prePhonemeLength": 0.1,
    "postPhonemeLength": 0.5,
    "outputSamplingRate": 24000,
}

# 利用するスタイルID（あなたの要望に合わせて固定）
STYLE_PRESETS = [
    {"label": "のーまる", "id": 1},
    {"label": "いっしょうけんめい", "id": 7},
    {"label": "ごきげん", "id": 40},
    {"label": "どやがお", "id": 45},
    {"label": "ふくれっつら", "id": 41},
    {"label": "しょんぼり", "id": 42},
    {"label": "ないしょばなし", "id": 43},
    {"label": "ひっさつわざ", "id": 44},
    {"label": "ぬむぬむ", "id": 46},
    {"label": "ぱじゃまぱーてぃー", "id": 47},
]
VALID_STYLE_IDS = {s["id"] for s in STYLE_PRESETS}

def _fetch_speakers() -> list:
    """COEIROINKから話者一覧を取得（リトライ付き）"""
    max_retries = 10
    retry_delay = 5  # seconds

    for attempt in range(max_retries):
        try:
            print(f"COEIROINK /v1/speakers へ接続試行 ({attempt + 1}/{max_retries})...")
            r = requests.get(f"{COEIROINK_URL}/v1/speakers", timeout=10)
            r.raise_for_status()
            print("COEIROINK 接続成功")
            return r.json()
        except requests.exceptions.RequestException as e:
            print(f"COEIROINK 接続失敗: {e}")
            if attempt < max_retries - 1:
                print(f"{retry_delay}秒後に再試行します。")
                time.sleep(retry_delay)
            else:
                print("COEIROINKへの最大リトライ回数に達しました。")
                raise

@app.on_event("startup")
def resolve_coeiroink_style():
    """
    WORKAROUND: coeiroink:2.5.1の /v1/speakers には meta_manager is not defined というバグがあるため、
    API呼び出しをバイパスし、固定の話者情報で初期化する。
    """
    global RESOLVED_STYLE_ID, RESOLVED_SPEAKER_UUID
    
    # Tsukuyomichan v2.0.0 のUUIDをハードコード
    RESOLVED_SPEAKER_UUID = "292ea286-3d5f-f1cc-157c-66462a6a9d08"
    
    # 環境変数またはデフォルトのスタイルIDを使用
    chosen_style_id = None
    if ENV_STYLE_ID:
        try:
            chosen_style_id = int(ENV_STYLE_ID)
        except ValueError:
            print("警告: COEIROINK_STYLE_ID は整数である必要があります。デフォルト値を使用します。")

    if chosen_style_id is None:
        # STYLE_PRESETSからデフォルトを選択
        chosen_style_id = STYLE_PRESETS[0]["id"] if STYLE_PRESETS else 1

    RESOLVED_STYLE_ID = chosen_style_id
    
    print("="*50)
    print("!!! WORKAROUND APPLIED !!!")
    print("COEIROINKの /v1/speakers API呼び出しをスキップしました。")
    print(f"固定話者情報: speakerUuid={RESOLVED_SPEAKER_UUID}, styleId={RESOLVED_STYLE_ID}")
    print("="*50)

# ==========================
# Gemini 応答（テキスト生成）
# ==========================
def _limited_contents():
    # 先頭は system_instruction、以降は末尾20件に制限
    tail = history[1:][-HISTORY_TURNS*2:]
    return [system_instruction] + tail


def gemini_reply(user_text: str) -> str:
    history.append(f"User: {user_text}")
    try:
        res = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=_limited_contents()
        )
        reply = getattr(res, "text", "").strip()
        if not reply:
            reply = "ごめん、返答を作れなかった。"
    except Exception as e:
        _log(f"[ERR][GEMINI] {e}")
        reply = "ごめん、AIモデルとのお話に失敗しちゃった。コンソールでログを確認してみて。もしかしてAPIキーが違うかも？"

    history.append(f"Gemini: {reply}")

    with open(BASE_DIR.parent / "chat_history.txt", "a", encoding="utf-8") as f:
        f.write(f"あなた: {user_text}\n")
        f.write(f"Gemini: {reply}\n\n")
    _log(f"[TEXT] user='{user_text}' reply='{reply}'")
    return reply


# ローカル会話（Ollama: gemma3:12b）
LOCAL_CHAT_MODEL = os.getenv("OLLAMA_MODEL_CHAT", "gemma3:12b")
LOCAL_CHAT_MODEL_4B = os.getenv("OLLAMA_MODEL_CHAT_4B", "gemma3:4b")

def local_reply_ollama(user_text: str, model: Optional[str] = None) -> str:
    # 簡易プロンプト: システム指示 + 直近履歴 + 今回のUser
    tail = history[1:][-HISTORY_TURNS*2:]
    convo = "\n".join(tail + [f"User: {user_text}", "Assistant:"])
    use_model = model or LOCAL_CHAT_MODEL
    # 4B のときは少し長めに話すよう追加指示を付与
    extra = ""
    if "4b" in str(use_model).lower():
        extra = (
            "\n出力ルール: 簡潔にし過ぎず、3〜6文で自然に。"
            " 友達感覚で喋って"
            " です・ます調は極力使わない\n"
        )
    prompt = system_instruction + extra + "\n" + convo
    try:
        url = f"{OLLAMA_BASE_URL}/api/generate"
        resp = requests.post(url, json={"model": use_model, "prompt": prompt, "stream": False}, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        reply = str(data.get("response", "")).strip()
        if not reply:
            reply = "…（ローカル応答なし）"
    except Exception as e:
        _log(f"[LOCAL_CHAT][ERR] {e}")
        reply = "…（ローカルLLMに接続できませんでした）"

    history.append(f"Gemini: {reply}")  # 形式を合わせて履歴に残す
    try:
        with open(BASE_DIR.parent / "chat_history.txt", "a", encoding="utf-8") as f:
            f.write(f"あなた: {user_text}\n")
            f.write(f"Local: {reply}\n\n")
    except Exception:
        pass
    return reply


def local_reply_ollama_stream(
    user_text: str,
    *,
    model: Optional[str] = None,
    tts_style_id: int,
    tts_overrides: Optional[Dict[str, Any]] = None,
    engine_label: str = "local",
) -> Tuple[str, List[str]]:
    """Stream tokens from Ollama and run TTS per sentence. Returns (full_text, audio_paths)."""
    tail = history[1:][-HISTORY_TURNS * 2:]
    convo = "\n".join(tail + [f"User: {user_text}", "Assistant:"])
    use_model = model or LOCAL_CHAT_MODEL
    extra = ""
    if "4b" in str(use_model).lower():
        extra = (
            "\n出力ルール: 簡潔にし過ぎず、3〜6文で自然に。"
            " 友達感覚で喋って。"
            " です・ます調は極力使わないように。\n"
        )
    prompt = system_instruction + extra + "\n" + convo

    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload = {"model": use_model, "prompt": prompt, "stream": True}

    _log(f"[INFO] engine={engine_label} model={use_model} streaming start")
    full_text = ""
    buffer = ""
    audio_paths: List[str] = []
    fallback_reason: Optional[str] = None

    try:
        with requests.post(url, json=payload, stream=True, timeout=300) as resp:
            resp.raise_for_status()
            resp.encoding = "utf-8"
            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except Exception:
                    continue
                token = str(data.get("response", ""))
                if token:
                    full_text += token
                    buffer += token
                    segs, buffer = _split_sentences(buffer)
                    for seg in segs:
                        try:
                            path = coeiroink_tts(seg, style_id=tts_style_id, tts_overrides=tts_overrides)
                            audio_paths.append(f"/audio/{path.name}")
                            _log(f"[INFO] engine={engine_label} segment_tts ok text='{seg[:40]}' file='{path.name}'")
                        except Exception as e:
                            _log(f"[ERR] engine={engine_label} segment_tts fail text='{seg[:40]}' err={e}")
                            fallback_reason = fallback_reason or "segment_fail"
                if data.get("done"):
                    break
    except Exception as e:
        _log(f"[LOCAL_CHAT][ERR][stream] engine={engine_label} {e}")
        if not full_text:
            full_text = "…（ローカルLLMに接続できませんでした）"

    last = buffer.strip()
    if last:
        try:
            path = coeiroink_tts(last, style_id=tts_style_id, tts_overrides=tts_overrides)
            audio_paths.append(f"/audio/{path.name}")
            _log(f"[INFO] engine={engine_label} segment_tts ok (final) text='{last[:40]}' file='{path.name}'")
        except Exception as e:
            _log(f"[ERR] engine={engine_label} segment_tts final fail text='{last[:40]}' err={e}")
            fallback_reason = fallback_reason or "segment_fail"

    if not full_text.strip():
        full_text = "（空の応答）"
    if not audio_paths:
        fallback_reason = fallback_reason or "no_audio"

    if fallback_reason and full_text.strip():
        try:
            _log(f"[WARN] engine={engine_label} fallback full_tts start reason={fallback_reason}")
            if audio_paths:
                for prev in list(audio_paths):
                    try:
                        prev_name = prev.split("/")[-1]
                        if prev_name:
                            (OUT_DIR / prev_name).unlink(missing_ok=True)
                    except Exception:
                        pass
            path = coeiroink_tts(full_text, style_id=tts_style_id, tts_overrides=tts_overrides)
            audio_paths = [f"/audio/{path.name}"]
            _log(f"[WARN] engine={engine_label} fallback full_tts ok file='{path.name}'")
        except Exception as e:
            _log(f"[ERR] engine={engine_label} fallback full_tts fail reason={fallback_reason}: {e}")

    history.append(f"User: {user_text}")
    history.append(f"Gemini: {full_text}")
    try:
        with open(BASE_DIR.parent / "chat_history.txt", "a", encoding="utf-8") as f:
            f.write(f"あなた: {user_text}\n")
            f.write(f"Local: {full_text}\n\n")
    except Exception:
        pass

    _log(f"[INFO] engine={engine_label} streaming done text_len={len(full_text)} segs={len(audio_paths)}")
    return full_text, audio_paths

# ==========================
# TTS パラメータ自動決定（基本: Gemma via Ollama、フォールバック: Gemini）
# ==========================
VOICE_DIRECTOR_PROMPT = """あなたはTTS音声監督。ユーザー発話の感情・文脈から、以下のJSONだけを厳密に出力して。
- styleId: 次の集合のいずれかだけ [1,7,40,41,42,43,44,45,46,47]
- speedScale: 0.7〜1.4 の小数
- volumeScale: 0.8〜1.3 の小数
- pitchScale: -0.3〜0.3 の小数
- intonationScale: 0.8〜1.6 の小数
- prePhonemeLength: 0.05〜0.15 の小数
- postPhonemeLength: 0.35〜0.7 の小数
- outputSamplingRate: 24000 または 48000
- reason: 50字以内の短い説明（ログ用）

出力は JSON オブジェクト1個のみ。説明や前置きは一切なし。"""

def gemini_choose_tts(user_text: str) -> Dict[str, Any]:
    res = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[VOICE_DIRECTOR_PROMPT, f"ユーザー発話:{user_text}"]
    )
    txt = getattr(res, "text", "").strip()
    try:
        obj = json.loads(txt)
    except Exception:
        obj = {}

    style_id = obj.get("styleId")
    if style_id not in VALID_STYLE_IDS:
        low = user_text.lower()
        if any(k in low for k in ["内緒", "ないしょ", "ひそひそ"]):
            style_id = 43
        elif any(k in low for k in ["楽しい", "最高", "嬉", "やった", "草", "ｗ"]):
            style_id = 40
        elif any(k in low for k in ["しょんぼり", "悲", "落ち込", "ごめん"]):
            style_id = 42
        elif any(k in low for k in ["怒", "ムカ", "ふくれ"]):
            style_id = 41
        else:
            style_id = 1

    def clamp(v, lo, hi, default):
        try:
            v = float(v)
        except Exception:
            return default
        return max(lo, min(hi, v))

    params = {
        "styleId": int(style_id),
        "speedScale": clamp(obj.get("speedScale", 1.0), 0.7, 1.4, 1.0),
        "volumeScale": clamp(obj.get("volumeScale", 1.0), 0.8, 1.3, 1.0),
        "pitchScale": clamp(obj.get("pitchScale", 0.0), -0.3, 0.3, 0.0),
        "intonationScale": clamp(obj.get("intonationScale", 1.0), 0.8, 1.6, 1.0),
        "prePhonemeLength": clamp(obj.get("prePhonemeLength", 0.1), 0.05, 0.15, 0.1),
        "postPhonemeLength": clamp(obj.get("postPhonemeLength", 0.5), 0.35, 0.7, 0.5),
        "outputSamplingRate": 48000 if int(obj.get("outputSamplingRate", 24000)) == 48000 else 24000,
        "reason": str(obj.get("reason", "推定で選択"))
    }
    return params

# ==========================
# 背景LLM（Gemma via Ollama）でTTSとポーズを決める
# 失敗時は従来のロジックにフォールバック

def _ollama_generate(prompt: str) -> str:
    try:
        url = f"{OLLAMA_BASE_URL}/api/generate"
        resp = requests.post(url, json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False}, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        return str(data.get("response", "")).strip()
    except Exception as e:
        _log(f"[OLLAMA][ERR] {e}")
        raise

def choose_tts_by_gemma(user_text: str) -> Dict[str, Any]:
    prompt = VOICE_DIRECTOR_PROMPT + "\nユーザー発話:" + user_text
    try:
        txt = _ollama_generate(prompt)
        obj = json.loads(txt)
    except Exception:
        # フォールバック: 既存Geminiロジック
        return gemini_choose_tts(user_text)

    def clamp(v, lo, hi, default):
        try:
            v = float(v)
        except Exception:
            return default
        return max(lo, min(hi, v))

    style_id = obj.get("styleId")
    if style_id not in VALID_STYLE_IDS:
        return gemini_choose_tts(user_text)

    return {
        "styleId": int(style_id),
        "speedScale": clamp(obj.get("speedScale", 1.0), 0.7, 1.4, 1.0),
        "volumeScale": clamp(obj.get("volumeScale", 1.0), 0.8, 1.3, 1.0),
        "pitchScale": clamp(obj.get("pitchScale", 0.0), -0.3, 0.3, 0.0),
        "intonationScale": clamp(obj.get("intonationScale", 1.0), 0.8, 1.6, 1.0),
        "prePhonemeLength": clamp(obj.get("prePhonemeLength", 0.1), 0.05, 0.15, 0.1),
        "postPhonemeLength": clamp(obj.get("postPhonemeLength", 0.5), 0.35, 0.7, 0.5),
        "outputSamplingRate": 48000 if int(obj.get("outputSamplingRate", 24000)) == 48000 else 24000,
        "reason": str(obj.get("reason", "ollama-gemma 推定"))
    }

POSE_TIMELINE_PROMPT = (
    "あなたは3Dアバターのモーション生成AIです。JSONのみ出力してください。\n"
    "形式: {\"head\":{\"timeline\":[[t,y], ...]}} tは0..1昇順、yは-0.6..0.6(ラジアン)。\n"
    "終端は0付近に戻す。説明は一切不要。\n"
)

def pose_timeline_by_gemma(user_text: str) -> Dict[str, Any]:
    try:
        txt = _ollama_generate(POSE_TIMELINE_PROMPT + "ユーザー発話:" + user_text)
        obj = json.loads(txt)
        tl = (((obj or {}).get("head") or {}).get("timeline"))
        if isinstance(tl, list) and tl:
            cleaned = []
            for kp in tl:
                if isinstance(kp, (list, tuple)) and len(kp) == 2:
                    try:
                        t = float(kp[0]); y = float(kp[1])
                    except Exception:
                        continue
                    t = max(0.0, min(1.0, t))
                    y = max(-0.6, min(0.6, y))
                    cleaned.append([t, y])
            if cleaned:
                cleaned.sort(key=lambda x: x[0])
                return {"head": {"timeline": cleaned}}
    except Exception as e:
        _log(f"[POSE][OLLAMA][ERR] {e}")

    # フォールバック: 適度な小振りのタイムライン
    return {"head": {"timeline": [[0.0, 0.0],[0.25, 0.15],[0.6, -0.1],[1.0, 0.0]]}}

# 後方互換: /api/pose は 0 を返すだけ（フロントはもう使わない方針）
@app.api_route("/api/pose", methods=["GET", "POST"])
def api_pose_compat():
    return {"head": {"y": 0.0}}


async def _process_chat_request(
    user_text: str,
    styleId: Optional[int],
    autoMode: Optional[str],
    poseMode: Optional[str],
    chatEngine: Optional[str],
) -> Dict[str, Any]:
    engine = (str(chatEngine).lower() if chatEngine is not None else "")
    auto = _parse_bool(autoMode)
    chosen_style = RESOLVED_STYLE_ID
    tts_overrides = None
    engine_name = engine or "cloud"
    _log(f"[INFO] processing request engine={engine_name} auto={auto}")

    def _apply_auto_params(src: str) -> None:
        nonlocal chosen_style, tts_overrides
        tts = choose_tts_by_gemma(src or "")
        chosen_style = tts["styleId"]
        tts_overrides = {
            k: tts[k]
            for k in (
                "speedScale",
                "volumeScale",
                "pitchScale",
                "intonationScale",
                "prePhonemeLength",
                "postPhonemeLength",
                "outputSamplingRate",
            )
        }

    audio_field: Any
    reply_text: str

    if engine in ("local", "local12", "local4", "local-4b", "local4b"):
        if auto:
            _apply_auto_params(user_text)
        elif styleId is not None and int(styleId) in VALID_STYLE_IDS:
            chosen_style = int(styleId)
        elif chosen_style is None and STYLE_PRESETS:
            chosen_style = STYLE_PRESETS[0]["id"]

        engine_label = "local" if engine in ("local", "local12") else "local4"
        model_to_use = LOCAL_CHAT_MODEL if engine_label == "local" else LOCAL_CHAT_MODEL_4B
        reply_text, audio_list = local_reply_ollama_stream(
            user_text,
            model=model_to_use,
            tts_style_id=chosen_style or RESOLVED_STYLE_ID or STYLE_PRESETS[0]["id"],
            tts_overrides=tts_overrides,
            engine_label=engine_label,
        )
        audio_field = audio_list
        _log(f"[INFO] engine={engine_label} streaming ready segs={len(audio_list)}")
    else:
        _log(f"[INFO] engine={engine_name} full reply start")
        reply_text = gemini_reply(user_text)
        _log(f"[INFO] engine={engine_name} full reply done")
        if auto:
            _apply_auto_params(reply_text)
        elif styleId is not None and int(styleId) in VALID_STYLE_IDS:
            chosen_style = int(styleId)
        elif chosen_style is None and STYLE_PRESETS:
            chosen_style = STYLE_PRESETS[0]["id"]

        try:
            outpath = coeiroink_tts(
                reply_text,
                style_id=chosen_style,
                tts_overrides=tts_overrides,
            )
            audio_field = f"/audio/{outpath.name}"
        except Exception as e:
            _log(f"[ERR] engine={engine_name} synthesis error: {e}")
            return {"error": f"COEIROINK error: {e}", "status_code": 502}

    pose_enabled = _parse_bool(poseMode) or auto
    pose = {"head": {"timeline": [[0.0, 0.0], [1.0, 0.0]]}}
    if pose_enabled:
        pose = pose_timeline_by_gemma(user_text)

    return {
        "text": reply_text,
        "audio": audio_field,
        "auto": auto,
        "tts": {"styleId": chosen_style, **(tts_overrides or {})},
        "pose": pose,
    }

# ==========================
# COEIROINK 呼び出し
# ==========================
def build_synthesis_payload(text: str, style_id: int, tts_overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = {
        "speakerUuid": RESOLVED_SPEAKER_UUID,
        "styleId": int(style_id),
        "text": text,
        **DEFAULT_TTS,
    }
    if tts_overrides:
        payload.update(tts_overrides)
    return payload

def coeiroink_tts(text: str, style_id: int, tts_overrides: Optional[Dict[str, Any]] = None) -> Path:
    if not RESOLVED_SPEAKER_UUID or RESOLVED_STYLE_ID is None:
        raise RuntimeError("COEIROINK が未初期化です（speaker/style 未解決）")

    filename = f"reply_{uuid.uuid4().hex}.wav"
    outpath = OUT_DIR / filename
    payload = build_synthesis_payload(text, style_id, tts_overrides)

    try:
        s = requests.post(
            f"{COEIROINK_URL}/v1/synthesis",
            json=payload,
            headers={"Accept": "audio/wav", "Content-Type": "application/json"},
            timeout=120,
        )
        if not s.ok:
            raise requests.HTTPError(f"{s.status_code} {s.reason} body={s.text}", response=s)
        outpath.write_bytes(s.content)
        return outpath
    except requests.HTTPError as e:
        body = e.response.text if e.response is not None else ""
        raise RuntimeError(f"/v1/synthesis 失敗: HTTP {e.response.status_code if e.response else ''} {e} {body}")
    except Exception as e:
        raise RuntimeError(f"/v1/synthesis 呼び出しで例外: {e}")

# ==========================
# API: スタイル一覧（固定）
# ==========================
@app.get("/api/styles")
def list_styles():
    return {"styles": STYLE_PRESETS}

# ==========================
# API: テキスト → 返答 + 音声 (+首ヨー角)
# ==========================
def _parse_bool(v: Optional[str]) -> bool:
    if v is None:
        return False
    return str(v).lower() in {"1", "true", "t", "yes", "y", "on"}

@app.post("/api/text")
async def text_to_reply(
    text: str = Form(...),
    styleId: Optional[int] = Form(None),
    autoMode: Optional[str] = Form(None),  # "1"/"true" ???????:?????????
    poseMode: Optional[str] = Form(None),  # "1"/"true" ?????????????????
    chatEngine: Optional[str] = Form(None),  # 'local' ??????LLM
):
    user_text = (text or "").strip()
    if not user_text:
        return JSONResponse({"error": "テキストが空です"}, status_code=400)

    result = await _process_chat_request(user_text, styleId, autoMode, poseMode, chatEngine)

    if "error" in result:
        return JSONResponse({"error": result["error"]}, status_code=result.get("status_code", 500))

    result["stt"] = user_text
    return result

@app.post("/api/voice")
async def voice_to_reply(
    file: UploadFile = File(...),
    styleId: Optional[int] = Form(None),
    autoMode: Optional[str] = Form(None),
    poseMode: Optional[str] = Form(None),
    chatEngine: Optional[str] = Form(None),  # 'cloud'|'local'|'local4'
):
    tmp_path: Optional[Path] = None
    wav_path: Optional[Path] = None
    try:
        tmp_path = OUT_DIR / f"tmp_{uuid.uuid4().hex}.webm"
        with open(tmp_path, "wb") as f:
            f.write(await file.read())

        wav_path = tmp_path.with_suffix(".wav")
        AudioSegment.from_file(tmp_path, format="webm").export(wav_path, format="wav")

        rec = sr.Recognizer()
        with sr.AudioFile(str(wav_path)) as src:
            audio = rec.record(src)

        try:
            user_text = rec.recognize_google(audio, language="ja-JP")
            cleaned_text = (user_text or "").replace("\n", " ").strip()
            _log(f"[INFO] voice stt ok text={cleaned_text[:80]!r}")
        except sr.UnknownValueError:
            _log("[ERR] voice stt unknown")
            return JSONResponse({"error": "音声を認識できませんでした"}, status_code=400)
        except sr.RequestError as e:
            _log(f"[ERR] voice stt request error: {e}")
            return JSONResponse({"error": f"音声認識サービスに接続できません: {e}"}, status_code=502)

        result = await _process_chat_request(cleaned_text, styleId, autoMode, poseMode, chatEngine)

        if "error" in result:
            return JSONResponse({"error": result["error"]}, status_code=result.get("status_code", 500))

        result["stt"] = cleaned_text
        return result

    finally:
        try:
            if tmp_path and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            if wav_path and wav_path.exists():
                wav_path.unlink(missing_ok=True)
        except Exception:
            pass
@app.get("/audio/{filename}")
def get_audio(filename: str):
    path = OUT_DIR / filename
    if not path.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(path, media_type="audio/wav")

# ==========================
# フロント配信
# ==========================
if FRONT_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONT_DIR), html=True), name="static")

VRMA_DIR = FRONT_DIR / "vrma"   # frontend/vrma を配信
if VRMA_DIR.exists():
    app.mount("/vrma", StaticFiles(directory=str(VRMA_DIR)), name="vrma")
