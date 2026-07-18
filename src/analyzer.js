/**
 * AuraSonic Spectrum Audio Analyzer
 * Pure lightweight real-time FFT spectrum processing module.
 */
export class AudioAnalyzer {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.micStream = null;
    this.fftSize = 1024;
    this.onProgress = null;
    this.isLooping = false;
  }

  /**
   * Start listening to the microphone
   */
  async startMicrophone() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.stopExistingSources();

    try {
      // Disable echo cancellation, noise suppression, and auto gain control so high frequency sounds aren't filtered out!
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          latency: 0.01
        }
      };

      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);
      
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.25; // balances speed and stability
      
      this.sourceNode.connect(this.analyser);
      
      this.sampleRate = this.audioCtx.sampleRate;
      this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
      
      this.startAnalysisLoop();
      return true;
    } catch (err) {
      console.error('マイクの取得に失敗しました:', err);
      this.stop();
      throw err;
    }
  }

  stopExistingSources() {
    this.isLooping = false;
    
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  startAnalysisLoop() {
    this.isLooping = true;
    
    const loop = () => {
      if (!this.isLooping || !this.analyser) return;

      this.analyser.getFloatFrequencyData(this.dataArray);
      
      if (this.onProgress) {
        this.onProgress(this.dataArray, this.sampleRate);
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  stop() {
    this.stopExistingSources();
    if (this.audioCtx) {
      this.audioCtx.suspend();
    }
  }
}
