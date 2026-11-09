import json, sys, os, queue, threading
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
import torch
import soundfile as sf
from omnivoice import OmniVoice

class Cancelled(Exception):
    pass

model = OmniVoice.from_pretrained('k2-fsa/OmniVoice', device_map='mps', dtype=torch.float16)
requests = queue.Queue(maxsize=8)
cancelled = set()
live = set()
lock = threading.Lock()
active = None

def check_cancel(*_):
    with lock:
        if active in cancelled:
            raise Cancelled()

# Generation calls the model once per refinement step. Stop between steps without
# discarding the loaded weights; a running GPU kernel must finish first.
model.register_forward_pre_hook(check_cancel)

def read_requests():
    for line in sys.stdin:
        try:
            req = json.loads(line)
            if 'cancel' in req:
                with lock:
                    if req['cancel'] in live:
                        cancelled.add(req['cancel'])
            else:
                with lock:
                    live.add(req.get('id'))
                requests.put(req)
        except (ValueError, TypeError):
            continue
    requests.put(None)

threading.Thread(target=read_requests, daemon=True).start()
print(json.dumps({'ready': True}), flush=True)
while True:
    req = requests.get()
    if req is None:
        break
    with lock:
        active = req.get('id')
    try:
        check_cancel()
        audio = model.generate(text=req['text'], language='en', instruct='male, British accent, low pitch', speed=req.get('speed', 1.0), num_step=int(req.get('steps', 16)))
        check_cancel()
        sf.write(req['path'], audio[0], model.sampling_rate)
        check_cancel()
        print(json.dumps({'id': req['id'], 'ok': True}), flush=True)
    except Cancelled:
        try:
            os.unlink(req['path'])
        except OSError:
            pass
        print(json.dumps({'id': req.get('id'), 'cancelled': True}), flush=True)
    except Exception as exc:
        print(json.dumps({'id': req.get('id'), 'error': str(exc)}), flush=True)
    finally:
        with lock:
            cancelled.discard(active)
            live.discard(active)
            active = None
