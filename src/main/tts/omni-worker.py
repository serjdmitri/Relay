import json, sys, os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
import torch
import soundfile as sf
from omnivoice import OmniVoice
model = OmniVoice.from_pretrained('k2-fsa/OmniVoice', device_map='mps', dtype=torch.float16)
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    try:
        req = json.loads(line)
        audio = model.generate(text=req['text'], language='en', instruct='male, British accent, low pitch', num_step=16)
        sf.write(req['path'], audio[0], model.sampling_rate)
        print(json.dumps({'id':req['id'], 'ok':True}), flush=True)
    except Exception as exc:
        print(json.dumps({'id':req.get('id'), 'error':str(exc)}), flush=True)
