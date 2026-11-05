"""Local, isolated video worker. stdout JSON lines are the IPC protocol."""
import os, sys, json, subprocess, math, hashlib, wave
from pathlib import Path

def emit(**data):
    print('JAZZ:' + json.dumps(data, allow_nan=False), flush=True)

def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def run(args):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode:
        raise ValueError('Medien können nicht dekodiert werden: ' + p.stderr.decode(errors='replace')[-700:])
    return p.stdout

def preview(file, directory):
    import cv2
    cap = cv2.VideoCapture(file)
    fps, count = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
    if not math.isfinite(fps) or fps <= 0 or count <= 0:
        raise ValueError('Kein unterstütztes Videobild gefunden.')
    duration = count / fps
    if duration > 1800:
        raise ValueError('Das Video ist zu lang (maximal 30 Minuten).')
    frames=[]
    for i, portion in enumerate([0.15, 0.5, 0.8]):
        cap.set(cv2.CAP_PROP_POS_MSEC, duration*portion*1000)
        ok, frame=cap.read()
        if ok:
            frame=cv2.resize(frame,(720,round(frame.shape[0]*720/frame.shape[1])))
            name=str(Path(directory)/f'preview-{i}.jpg'); cv2.imwrite(name,frame); frames.append(name)
    cap.release()
    emit(preview=frames, duration=duration, fps=fps)

def visual(file, calibration):
    import cv2, numpy as np
    cap=cv2.VideoCapture(file)
    fps=cap.get(cv2.CAP_PROP_FPS); total=cap.get(cv2.CAP_PROP_FRAME_COUNT)
    c4,c5,line=calibration['c4'],calibration['c5'],calibration['line']
    width=(c5-c4)/7
    if width<3: raise ValueError('C4 und C5 müssen in dieser Reihenfolge mindestens 21 Pixel auseinander liegen.')
    # White-key centres, black keys halfway between adjacent white centres.
    positions={}
    diatonic={0:0,2:1,4:2,5:3,7:4,9:5,11:6,1:.5,3:1.5,6:3.5,8:4.5,10:5.5}
    for pitch in range(21,109):
        positions[pitch]=c4+((pitch//12-5)*7+diatonic[pitch%12])*width
    active={}; notes=[]; frame_index=0; previous=-1
    while True:
        ok,frame=cap.read()
        if not ok: break
        height=round(frame.shape[0]*720/frame.shape[1]); frame=cv2.resize(frame,(720,height))
        if not 4<=line<height: raise ValueError('Die Anschlaglinie liegt außerhalb des Videobilds.')
        stamp=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
        if stamp<=previous: stamp=frame_index/fps
        previous=stamp
        hsv=cv2.cvtColor(frame,cv2.COLOR_BGR2HSV)
        # Match each coloured stripe component to one key, avoiding duplicate
        # white/black detections at compressed bar edges.
        stripe=hsv[round(line)-3:round(line),:]
        mask=((stripe[:,:,1]>95)&(stripe[:,:,2]>90)).astype(np.uint8)*255
        count,labels,stats,centres=cv2.connectedComponentsWithStats(mask)
        detected={}
        for k in range(1,count):
            x=float(centres[k][0]); w=stats[k,cv2.CC_STAT_WIDTH]
            if w<2 or w>width*1.25: continue
            pitch=min(positions,key=lambda p:abs(positions[p]-x))
            if abs(positions[pitch]-x)>width*.38: continue
            strength=min(1.,stats[k,cv2.CC_STAT_AREA]/max(1,w*3))
            detected[pitch]=strength
        # A simultaneous screen-wide colour transition is not a piano chord.
        if len(detected)>12: detected={}
        for pitch in list(set(active)|set(detected)):
            on=pitch in detected
            if on and pitch not in active: active[pitch]=(stamp,[])
            if on: active[pitch][1].append(detected[pitch])
            elif pitch in active:
                start,scores=active.pop(pitch)
                if stamp-start>=max(.035,1/fps): notes.append(dict(pitch=pitch,start=start,end=stamp,velocity=80,score=min(sum(scores)/len(scores),.6 if stamp-start<.1 else 1.)))
        frame_index+=1
        if frame_index%120==0: emit(progress=min(.98,frame_index/max(total,1)),message='Fallende Noten verfolgen')
    for pitch,(start,scores) in active.items():
        if previous>start: notes.append(dict(pitch=pitch,start=start,end=previous,velocity=80,score=.4))
    cap.release()
    offset=calibration.get('offsetMs',0)/1000
    for n in notes:
        n['start']=max(0,n['start']+offset);n['end']=max(n['start']+.001,n['end']+offset)
    return notes, max(previous,max((n['end'] for n in notes),default=0)), 'Kalibrierte farbige Piano-Roll, v1; '+json.dumps(calibration)

def audio(file, model, directory):
    import numpy as np, torch
    torch.set_num_threads(max(1,min(4,os.cpu_count() or 1)))
    from piano_transcription_inference import PianoTranscription
    wav=str(Path(directory)/'audio.wav')
    run([ffmpeg(),'-v','error','-nostdin','-i',file,'-vn','-ac','1','-ar','16000','-t','1801','-y',wav])
    with wave.open(wav,'rb') as source:
        length=source.getnframes()/source.getframerate()
        if length>1800: raise ValueError('Das Video ist zu lang (maximal 30 Minuten).')
        if source.getsampwidth()!=2: raise ValueError('Ungültiges Audioformat.')
        audio=np.frombuffer(source.readframes(source.getnframes()),dtype='<i2').astype(np.float32)/32768
    if len(audio)<1600 or np.max(np.abs(audio))<.0001: raise ValueError('Keine hörbare Klavieraufnahme gefunden.')
    audible=np.flatnonzero(np.abs(audio)>.0001)
    audible_stop=(int(audible[-1])+1)/16000 if len(audible) else length
    transcriber=PianoTranscription(checkpoint_path=model,device='cpu')
    notes=[]
    # Bounded inference memory. Two seconds of context around each 16-second core.
    for base in range(0,len(audio),16*16000):
        lo=max(0,base-2*16000); hi=min(len(audio),base+18*16000)
        result=transcriber.transcribe(audio[lo:hi],None)
        for n in result['est_note_events']:
            start=float(n['onset_time'])+lo/16000; stop=float(n['offset_time'])+lo/16000
            if not base/16000<=start<min(length,base/16000+16): continue
            frames=result['output_dict']['frame_output']; pitch=int(n['midi_note'])
            a=round(n['onset_time']*100); b=max(a+1,round(n['offset_time']*100))
            score=float(np.mean(frames[a:b,pitch-21]))
            notes.append(dict(pitch=pitch,start=start,end=max(start+.001,min(stop,length,audible_stop)),velocity=max(1,min(127,int(n['velocity']))),score=score))
        emit(progress=min(.99,(base+16*16000)/len(audio)),message='Klavierklang lokal transkribieren')
    return notes,length,'Kong CRNN note/pedal 4034264 (CPU)'

def main():
    request=json.load(open(sys.argv[1])); action=request['action']; directory=request['directory']
    if action=='check':
        import torch,cv2,librosa,piano_transcription_inference
        emit(ready=True, ffmpeg=ffmpeg()); return
    if action=='preview': preview(request['file'],directory); return
    if action=='audio': notes,duration,model=audio(request['file'],request['model'],directory)
    elif action=='visual': notes,duration,model=visual(request['file'],request['calibration'])
    else: raise ValueError('Unbekanntes Verfahren.')
    if not notes: raise ValueError('Keine Klaviernoten erkannt. Bitte Kalibrierung prüfen oder Audioerkennung wählen.')
    if len(notes)>150000: raise ValueError('Zu viele erkannte Noten. Bitte einen kürzeren Ausschnitt verwenden.')
    target=str(Path(directory)/'result.json')
    Path(target).write_text(json.dumps(dict(notes=notes,duration=duration,model=model),allow_nan=False))
    emit(result=target)

if __name__=='__main__':
    try: main()
    except Exception as e:
        emit(error=str(e)); sys.exit(1)
