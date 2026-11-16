"""The narrator: one place for the voice, the speeds and the ffmpeg chain that both narration tools use."""
import subprocess
import numpy as np, soundfile as sf

VOICE = "bm_george"
LANG = "en-gb"
SPEED_STORY = 0.90      # stories and passing-by stories
SPEED_CUE = 1.0         # turn cues and system clips
LEAD_STORY, LEAD_ASIDE, LEAD_CUE = 1.6, 0.9, 0.05   # seconds of silence before the clip
SR = 24000
CHAIN = ("highpass=f=70,equalizer=f=220:t=q:w=1.0:g=1.5,equalizer=f=3200:t=q:w=1.2:g=2,"
         "acompressor=threshold=-20dB:ratio=2.5:attack=15:release=180,aecho=0.9:0.25:38:0.12,"
         "loudnorm=I=-16:TP=-1.5:LRA=9")

def encode(audio, sr, out, tmp="/tmp/voice_tmp.wav"):
    """Write float audio through the chain to a 24 kHz mono 48 kbps mp3."""
    sf.write(tmp, audio.astype(np.float32), sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-af", CHAIN, "-ar", str(SR), "-ac", "1", "-b:a", "48k", out], check=True)
