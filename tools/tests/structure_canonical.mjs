import { createHash } from 'node:crypto';

// The fixture graph contains plain ordered records, arrays and tagged binary
// attributes. Encode values explicitly rather than depending on V8 heap layout
// or JSON's lossy treatment of undefined, nonfinite numbers and negative zero.
export function canonicalSignature(value) {
  const hash=createHash('sha256'),number=Buffer.allocUnsafe(8),strings=new Map();
  const string=value=>{
    let bytes=strings.get(value);if(!bytes){bytes=Buffer.from(value,'utf16le');strings.set(value,bytes);}
    hash.update('s'+value.length+':');hash.update(bytes);
  };
  function write(value){
    if(value===null){hash.update('l');return;}
    switch(typeof value){
      case 'undefined':hash.update('u');return;
      case 'boolean':hash.update(value?'t':'f');return;
      case 'number':
        if(Number.isNaN(value)){hash.update('q');return;}
        number.writeDoubleBE(value);hash.update('n');hash.update(number);return;
      case 'string':string(value);return;
      case 'bigint':hash.update('i');string(value.toString());return;
      case 'object':
        if(Array.isArray(value)){
          hash.update('a'+value.length+':');
          for(let i=0;i<value.length;i++)if(Object.hasOwn(value,i))write(value[i]);else hash.update('h');
        }else{
          const keys=Object.keys(value);hash.update('o'+keys.length+':');
          for(const key of keys){string(key);write(value[key]);}
        }
        return;
      default:throw Error('Unsupported canonical fixture value: '+typeof value);
    }
  }
  write(value);return hash.digest('hex');
}
