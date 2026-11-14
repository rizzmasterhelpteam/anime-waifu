const sharp=require(process.env.SHARP_MODULE || 'sharp');
const fs=require('fs');
const first=process.argv.includes('--seraphina');
const path=require('path');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'assets/previews',first?'seraphina-walk-atlas.png':'crimson-chibi-atlas.png');
const dest=path.join(root,'assets/sprites',first?'':'crimson')+path.sep;
(async()=>{
 const meta=await sharp(source).metadata();console.log(meta);
 const keys=first?['walk_left','walk_pass_left','walk_contact_right','walk_pass_right']:['idle','wave','think','celebrate','tea','tea_sip','idle_blink','wave_alt','walk_left','walk_pass_left','walk_contact_right','walk_pass_right'];
 const rows=first?1:3;
 for(let i=0;i<keys.length;i++){
  const left=Math.round((i%4)*meta.width/4),right=Math.round((i%4+1)*meta.width/4),top=Math.round(Math.floor(i/4)*meta.height/rows),bottom=Math.round((Math.floor(i/4)+1)*meta.height/rows);
  const {data,info}=await sharp(source).extract({left,top,width:right-left,height:bottom-top}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let x0=info.width,y0=info.height,x1=0,y1=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];if(a>160){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
  for(let j=0;j<data.length;j+=4) if(data[j+3]<8) {data[j]=data[j+1]=data[j+2]=data[j+3]=0;}
  const sprite=await sharp(data,{raw:info}).extract({left:x0,top:y0,width:x1-x0+1,height:y1-y0+1}).resize({height:550,width:420,fit:'inside'}).png().toBuffer();
  const m=await sharp(sprite).metadata();
  await sharp({create:{width:460,height:600,channels:4,background:'#00000000'}}).composite([{input:sprite,left:Math.round((460-m.width)/2),top:582-m.height}]).png().toFile(dest+keys[i]+'.png');
 }

})().catch(e=>{console.error(e);process.exit(1)});
