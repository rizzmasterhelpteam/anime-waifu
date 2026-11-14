// The AudioContext runs at 16 kHz. Transfer 20 ms PCM frames off the audio thread.
class VoiceCapture extends AudioWorkletProcessor {
 constructor(){super();this.frame=new Float32Array(320);this.offset=0;}
 process(inputs){const input=inputs[0]?.[0];if(input)for(const value of input){this.frame[this.offset++]=value;if(this.offset===320){this.port.postMessage(this.frame,[this.frame.buffer]);this.frame=new Float32Array(320);this.offset=0;}}return true;}
}
registerProcessor('voice-capture',VoiceCapture);
