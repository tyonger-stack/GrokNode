// Run only through docker exec in the existing box. No original scripts or
// token-router files are installed or replaced. stdout is binary RFB only.
export const applicationStreamProgram = String.raw`
const fs=require('fs'),net=require('net'),{spawn,spawnSync}=require('child_process');
const [botId,seat,id,mode]=process.argv.slice(1),display=':'+seat;
if(!/^[1-9][0-9]{0,2}$/.test(seat)||!/^0x[0-9a-f]{1,16}$/.test(id)||!['view','control'].includes(mode))process.exit(2);
function owner(){const s=JSON.parse(fs.readFileSync('/home/box/.sand-window-assignments.json','utf8'));if(s.assignments[botId]!==Number(seat))throw Error('Seat changed');if(s.tokens?.[botId]&&fs.readFileSync('/tmp/sand-window-tokens.d/'+seat,'utf8').trim()!==s.tokens[botId])throw Error('Seat changed');}
function windows(){const options={env:{...process.env,DISPLAY:display},encoding:'utf8',timeout:5000},r=spawnSync('xprop',['-root','_NET_CLIENT_LIST'],options);let ids=(r.stdout||'').match(/0x[0-9a-f]+/gi)||[];if(!ids.length){const tree=spawnSync('xwininfo',['-root','-tree'],options);ids=(tree.stdout||'').split(/\r?\n/).flatMap(line=>{const m=/^\s{5}(0x[0-9a-f]+) ".*?":.*?\s(\d+)x(\d+)[+-]/i.exec(line);return m&&Number(m[2])>150&&Number(m[3])>100?[m[1]]:[]});}if(!ids.map(x=>x.toLowerCase()).includes(id))throw Error('Window unavailable');}
let child,socket,closed=false;function stop(){if(closed)return;closed=true;socket?.destroy();child?.kill('SIGTERM');setTimeout(()=>{child?.kill('SIGKILL');process.exit(0)},100).unref();}
process.stdin.on('end',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
(async()=>{owner();windows();const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
if(mode==='control'){const focus=spawnSync('xdotool',['windowraise',id,'windowfocus',id],{env:{...process.env,DISPLAY:display},timeout:3000,stdio:'ignore'});if(focus.status!==0)throw Error('Application focus unavailable');}
const args=['-display',display,'-id',id,'-rfbport',String(port),'-localhost','-nopw','-forever','-shared','-noxdamage','-noshm','-nosel','-noclipboard','-nosetclipboard','-nosetprimary','-quiet'];if(mode==='view')args.push('-viewonly');
child=spawn('x11vnc',args,{env:{...process.env,DISPLAY:display},stdio:'ignore'});child.on('error',stop);child.on('exit',stop);
for(let i=0;i<50&&!closed;i++){const connected=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));});if(connected)break;await new Promise(r=>setTimeout(r,100));}
if(closed)return;owner();windows();socket=net.connect(port,'127.0.0.1');socket.on('error',stop);socket.on('close',stop);process.stdin.pipe(socket);socket.pipe(process.stdout);
const timer=setInterval(()=>{try{owner();windows()}catch{stop()}},3000);timer.unref();setTimeout(stop,900000).unref();
})().catch(()=>{console.error('Application viewer unavailable');stop();process.exitCode=1});`;
