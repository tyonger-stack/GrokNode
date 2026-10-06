// Standard Python ctypes + the image's libX11: no packages or GrokNode patches.
export const clipboardProgram = String.raw`
import ctypes as c, sys, time, select, json
L=c.CDLL('libX11.so.6'); U=c.c_ulong; P=c.c_void_p; I=c.c_int
def bind(name, args, result):
 f=getattr(L,name); f.argtypes=args; f.restype=result; return f
openD=bind('XOpenDisplay',[c.c_char_p],P); atom=bind('XInternAtom',[P,c.c_char_p,I],U)
root=bind('XDefaultRootWindow',[P],U); create=bind('XCreateSimpleWindow',[P,U,I,I,c.c_uint,c.c_uint,c.c_uint,U,U],U)
flush=bind('XFlush',[P],I); pending=bind('XPending',[P],I); nextE=bind('XNextEvent',[P,P],I)
owner=bind('XSetSelectionOwner',[P,U,U,U],I); getOwner=bind('XGetSelectionOwner',[P,U],U)
change=bind('XChangeProperty',[P,U,U,U,I,I,P,I],I); send=bind('XSendEvent',[P,U,I,c.c_long,P],I)
convert=bind('XConvertSelection',[P,U,U,U,U,U],I)
getProp=bind('XGetWindowProperty',[P,U,U,c.c_long,c.c_long,I,U,c.POINTER(U),c.POINTER(I),c.POINTER(U),c.POINTER(U),c.POINTER(P)],I)
free=bind('XFree',[P],I)
class Request(c.Structure):
 _fields_=[('type',I),('serial',U),('send_event',I),('display',P),('owner',U),('requestor',U),('selection',U),('target',U),('property',U),('time',U)]
class Notify(c.Structure):
 _fields_=[('type',I),('serial',U),('send_event',I),('display',P),('requestor',U),('selection',U),('target',U),('property',U),('time',U)]
class Event(c.Union):
 _fields_=[('type',I),('request',Request),('notify',Notify),('pad',c.c_long*24)]
d=openD(sys.argv[1].encode());
if not d: raise RuntimeError('X display unavailable')
w=create(d,root(d),0,0,1,1,0,0,0); clip=atom(d,b'CLIPBOARD',0); utf=atom(d,b'UTF8_STRING',0); targets=atom(d,b'TARGETS',0); prop=atom(d,b'NODE_AGENT_CLIPBOARD',0)
event=Event()
if sys.argv[2]=='read':
 if not getOwner(d,clip): print(json.dumps({'text':''})); sys.exit(0)
 convert(d,clip,utf,prop,w,0); flush(d); end=time.monotonic()+5
 while time.monotonic()<end:
  if not pending(d): time.sleep(.01); continue
  nextE(d,c.byref(event))
  if event.type!=31: continue
  if not event.notify.property: raise RuntimeError('Clipboard format unavailable')
  actual=U(); fmt=I(); count=U(); after=U(); value=P()
  getProp(d,w,prop,0,262144,0,0,c.byref(actual),c.byref(fmt),c.byref(count),c.byref(after),c.byref(value))
  if fmt.value!=8 or after.value: raise RuntimeError('Clipboard exceeds text limit')
  text=c.string_at(value,count.value).decode('utf-8','replace') if value else ''; free(value); print(json.dumps({'text':text})); sys.exit(0)
 raise RuntimeError('Clipboard read timed out')
data=sys.argv[3].encode('utf-8'); owner(d,clip,w,0); flush(d)
if getOwner(d,clip)!=w: raise RuntimeError('Clipboard ownership unavailable')
print(json.dumps({'written':True}),flush=True)
while True:
 while pending(d):
  nextE(d,c.byref(event))
  if event.type==29: sys.exit(0)
  if event.type!=30: continue
  r=event.request; p=r.property or r.target; success=0
  if r.target==targets:
   values=(U*3)(targets,utf,31); change(d,r.requestor,p,4,32,0,c.cast(values,P),3); success=p
  elif r.target in (utf,31):
   text=c.create_string_buffer(data); change(d,r.requestor,p,r.target,8,0,c.cast(text,P),len(data)); success=p
  reply=Event(); reply.notify=Notify(31,0,1,d,r.requestor,r.selection,r.target,success,r.time); send(d,r.requestor,0,0,c.byref(reply)); flush(d)
 ready,_,_=select.select([sys.stdin],[],[],.05)
 if ready and not sys.stdin.buffer.read(1): sys.exit(0)
`;
