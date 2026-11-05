"""True local inference regression, including invalid/empty recognition output."""
import json,subprocess,sys,os
from pathlib import Path
python=sys.executable;root=Path('test-results/video');root.mkdir(parents=True,exist_ok=True)
subprocess.run([python,'scripts/video/make-fixture.py'],check=True)
def run(action,file,calibration=None):
 request=root/'regression-request.json';request.write_text(json.dumps(dict(action=action,file=str(file),directory=str(root),model='resources/video/piano.pth',calibration=calibration)))
 result=subprocess.run([python,'scripts/video/runner.py',str(request)],capture_output=True,text=True)
 return result
v=run('visual',root/'visual.mp4',dict(c4=200,c5=340,line=220))
assert v.returncode==0,v.stdout+v.stderr
notes=json.loads((root/'result.json').read_text())['notes'];reference=json.loads((root/'reference.json').read_text())
assert len(notes)==len(reference),(len(notes),len(reference))
for n,(p,a,b) in zip(notes,reference):
 assert n['pitch']==p and abs(n['start']-a)<1/30+.001 and abs(n['end']-b)<1/30+.001,(n,(p,a,b))
print('PASS six visual notes, repeated key, black key, polyphony, onset/offset within one frame')
v=run('visual',root/'visual.mp4',dict(c4=200,c5=340,line=220,offsetMs=125));assert v.returncode==0
shifted=json.loads((root/'result.json').read_text())['notes'];assert abs(shifted[0]['start']-.425)<.001
print('PASS explicit image/audio time offset')
# A valid video with no coloured notes must fail, never produce a playable empty song.
import cv2,numpy as np
w=cv2.VideoWriter(str(root/'empty.mp4'),cv2.VideoWriter_fourcc(*'mp4v'),30,(720,400))
for _ in range(60):w.write(np.zeros((400,720,3),np.uint8))
w.release()
v=run('visual',root/'empty.mp4',dict(c4=200,c5=340,line=220));assert v.returncode!=0 and 'Keine Klaviernoten' in v.stdout
print('PASS empty visual result rejected')
(root/'corrupt.mp4').write_bytes(b'not a video')
v=run('preview',root/'corrupt.mp4');assert v.returncode!=0
print('PASS corrupt media rejected')
v=run('audio',root/'piano.mp4');assert v.returncode==0,v.stdout+v.stderr
notes=json.loads((root/'result.json').read_text())['notes']
for pitch,start in [(60,.313),(72,1.413),(57,2.6),(63,2.6),(66,2.6)]:
 assert any(n['pitch']==pitch and abs(n['start']-start)<.08 for n in notes),(pitch,start,notes)
assert any(n['score']<.65 for n in notes),'known harmonic false-positive should be exposed for review'
print('PASS five reference pitches incl. three-note chord, irregular timing within 80 ms; harmonic false-positive marked')
