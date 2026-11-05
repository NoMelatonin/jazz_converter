import cv2, numpy as np, json, subprocess, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent));from runner import ffmpeg
root=Path('test-results/video');root.mkdir(parents=True,exist_ok=True)
notes=[(60,.3,1.0),(64,.3,1.2),(67,.3,1.5),(61,1.8,2.4),(60,2.7,3.2),(72,3.6,4.2)]
writer=cv2.VideoWriter(str(root/'visual.mp4'),cv2.VideoWriter_fourcc(*'mp4v'),30,(720,400))
for i in range(150):
 frame=np.zeros((400,720,3),np.uint8);t=i/30
 for p,a,b in notes:
  if a<=t<b:
   x=200+({60:0,61:.5,64:2,67:4,72:7}[p])*20
   cv2.rectangle(frame,(int(x)-4,180),(int(x)+4,220),(0,160,255),-1)
 writer.write(frame)
writer.release()
# A real sampled piano chord with irregular timing, not a sine-wave surrogate.
manifest=json.load(open('public/piano/manifest.json'));samples={}
for key in ['C4','C5','Ds4','Fs4','A3']:
 path=Path('public/piano')/manifest[key]['file']
 raw=subprocess.check_output([ffmpeg(),'-v','error','-i',str(path),'-f','f32le','-ac','1','-ar','16000','-'])
 samples[key]=np.frombuffer(raw,dtype='<f4')
audio=np.zeros(6*16000,np.float32)
for name,p,a,b in [('C4',60,.313,1.003),('C5',72,1.413,2.108),('Ds4',63,2.6,3.4),('Fs4',66,2.6,3.4),('A3',57,2.6,3.4)]:
 sample=samples[name];length=round((b-a)*16000);start=round(a*16000);envelope=np.ones(length);envelope[-1600:]=np.linspace(1,0,1600)
 audio[start:start+length]+=sample[:length]*envelope*.5
import wave
with wave.open(str(root/'audio.wav'),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())
subprocess.run([ffmpeg(),'-v','error','-i',str(root/'visual.mp4'),'-i',str(root/'audio.wav'),'-c:v','copy','-c:a','aac','-y',str(root/'piano.mp4')],check=True)
(root/'reference.json').write_text(json.dumps(notes))
