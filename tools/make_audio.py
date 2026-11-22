"""音声ファイルを作る:  python tools/make_audio.py
必要: pip install edge-tts / Node.js
- audio/ に mp3 を作成（既存ファイルはスキップ）
- js/audio-map.js に「声|文 → ファイル」の対応表を書き出す
"""
import asyncio, hashlib, json, subprocess, sys
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "audio"
VOICES = {"f": "zh-CN-XiaoxiaoNeural", "m": "zh-CN-YunxiNeural"}
RATE = "-15%"  # HSK1の音声はゆっくりめ。アプリ側の速度 0.8 = このファイルの等速


def fname(v, t):
    return hashlib.md5(f"{v}|{t}".encode("utf-8")).hexdigest()[:12] + ".mp3"


async def make(item, sem):
    path = OUT / fname(item["v"], item["t"])
    if path.exists() and path.stat().st_size > 0:
        return False
    async with sem:
        for attempt in range(3):
            try:
                await edge_tts.Communicate(item["t"], VOICES[item["v"]], rate=RATE).save(str(path))
                return True
            except Exception as e:  # ネットワーク一時エラーは再試行
                if attempt == 2:
                    raise
                await asyncio.sleep(2)


async def main():
    raw = subprocess.run(["node", str(ROOT / "tools" / "extract.js")], capture_output=True, check=True).stdout
    items = json.loads(raw.decode("utf-8"))
    OUT.mkdir(exist_ok=True)
    sem = asyncio.Semaphore(6)
    made = sum(await asyncio.gather(*(make(i, sem) for i in items)))
    mapping = {f"{i['v']}|{i['t']}": "audio/" + fname(i["v"], i["t"]) for i in items}
    js = "// 自動生成（tools/make_audio.py）。手で編集しないでください\nconst AUDIO = " + json.dumps(mapping, ensure_ascii=False, indent=0) + ";\n"
    (ROOT / "js" / "audio-map.js").write_text(js, encoding="utf-8")
    keep = set(fname(i["v"], i["t"]) for i in items)
    stale = [p for p in OUT.glob("*.mp3") if p.name not in keep]
    print(f"{len(items)} texts, {made} newly generated, {len(stale)} unused files in audio/")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
