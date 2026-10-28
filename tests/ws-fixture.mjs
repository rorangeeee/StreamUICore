import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
export async function websocketServer({ opened = () => {}, message = () => {} } = {}) {
  const server = createServer(), clients = new Set();
  function send(socket, value) {
    const body = Buffer.from(JSON.stringify(value));
    const header = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81,126,body.length >> 8,body.length & 255]);
    socket.write(Buffer.concat([header,body]));
  }
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    clients.add(socket); socket.on('close',()=>clients.delete(socket)); socket.on('error',()=>{});
    let pending = Buffer.alloc(0);
    socket.on('data', bytes => {
      pending=Buffer.concat([pending,bytes]);
      while(pending.length>=6){
        let length=pending[1]&127, offset=2;const opcode=pending[0]&15;
        if(length===126){if(pending.length<8)return;length=pending.readUInt16BE(2);offset=4;}
        if(length===127||!(pending[1]&128)||pending.length<offset+4+length)return;
        const mask=pending.subarray(offset,offset+4),body=Buffer.from(pending.subarray(offset+4,offset+4+length));
        for(let i=0;i<body.length;i++)body[i]^=mask[i%4];pending=pending.subarray(offset+4+length);
        if(opcode===8){socket.destroy();return;}if(opcode===1)message(JSON.parse(body.toString()),socket,request,send);
      }
    });
    opened(socket,request,send);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return { url:'ws://127.0.0.1:'+server.address().port, clients, send, close:()=>{for(const c of clients)c.destroy();server.close();} };
}
export function subscriber(url){
  const socket=new WebSocket(url),queue=[],waiting=[];socket.binaryType='arraybuffer';
  socket.onmessage=event=>{
    const data=typeof event.data==='string'?JSON.parse(event.data):event.data;
    const index=waiting.findIndex(item=>item.predicate(data));
    if(index>=0){const [item]=waiting.splice(index,1);clearTimeout(item.timer);item.resolve(data);}else queue.push(data);
  };
  return { socket,next(predicate,timeout=8000){const index=queue.findIndex(predicate);if(index>=0)return Promise.resolve(queue.splice(index,1)[0]);return new Promise((resolve,reject)=>{const item={predicate,resolve,timer:setTimeout(()=>{waiting.splice(waiting.indexOf(item),1);reject(new Error('WebSocket event timeout'));},timeout)};waiting.push(item);});} };
}
