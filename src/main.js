import { AudioAnalyzer } from './analyzer.js';

// Instantiate the analyzer
const analyzer = new AudioAnalyzer();

// DOM elements
const btnToggleListen = document.getElementById('btn-toggle-listen');
const canvas = document.getElementById('visualizer-canvas');
const ctx = canvas.getContext('2d');

// Status banner elements
const statusBanner = document.getElementById('connection-status-banner');
const statusIcon = document.getElementById('status-icon');
const statusText = document.getElementById('status-text');

// State
let isListening = false;
let currentRole = 'loading'; // 'sender' | 'viewer' | 'loading'
let sendThrottleCount = 0;

// PeerJS instances
let peer = null;
let activeConnections = []; // For Sender: list of connected viewer channels
let p2pConnection = null;   // For Viewer: connection to the sender

// ==========================================
// 1. PeerJS WebRTC P2P Sync & Auto-Negotiation
// ==========================================

function updateStatus(role, message) {
  statusBanner.className = 'status-banner';
  if (role === 'sender') {
    statusBanner.classList.add('status-sender');
    statusIcon.textContent = '📡';
    statusText.textContent = `送信モード: ${message}`;
    btnToggleListen.style.display = 'block';
    btnToggleListen.disabled = false;
  } else if (role === 'viewer') {
    statusBanner.classList.add('status-viewer');
    statusIcon.textContent = '📱';
    statusText.textContent = `受信モード: ${message}`;
    btnToggleListen.style.display = 'none'; // Viewers don't need mic button
  } else {
    statusBanner.classList.add('status-loading');
    statusIcon.textContent = '🔄';
    statusText.textContent = message;
    btnToggleListen.style.display = 'none';
  }
}

// Auto-negotiate role: Try to be the master sender
function autoNegotiateRole() {
  destroyPeer();
  updateStatus('loading', '役割を判定中...');

  const masterId = 'aurasonic-master-sender';
  
  // Try to register as the master sender
  peer = new Peer(masterId);

  peer.on('open', (id) => {
    // Succeeded! This device is the sender (only one device can open this ID)
    currentRole = 'sender';
    console.log('送信機として登録されました:', id);
    updateStatus('sender', 'スピーカー横に設置してください (マイク待機中)');
    
    // Listen for incoming viewer connections
    peer.on('connection', (conn) => {
      console.log('受信機が接続しました:', conn.peer);
      activeConnections.push(conn);
      updateStatus('sender', `同期中 (受信機: ${activeConnections.length}台接続中)`);

      conn.on('close', () => {
        activeConnections = activeConnections.filter(c => c !== conn);
        updateStatus('sender', activeConnections.length > 0 
          ? `同期中 (受信機: ${activeConnections.length}台接続中)` 
          : 'スピーカー横に設置してください (マイク待機中)'
        );
      });
    });
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // The ID is already taken. Therefore, this device must be a Viewer!
      console.log('他の端末が既に送信機として登録されています。受信機モードを開始します。');
      startViewerMode();
    } else {
      console.error('PeerJS 接続エラー:', err);
      updateStatus('loading', '接続エラー。再試行中...');
      setTimeout(autoNegotiateRole, 3000);
    }
  });
}

// Initialize Viewer mode and connect to Master Sender
function startViewerMode() {
  destroyPeer();
  currentRole = 'viewer';
  updateStatus('viewer', '送信機を探しています...');

  // Start viewer with a random peer ID
  peer = new Peer();

  peer.on('open', (id) => {
    console.log('受信機が起動しました:', id);
    const masterId = 'aurasonic-master-sender';
    
    // Connect to the master sender
    p2pConnection = peer.connect(masterId);

    p2pConnection.on('open', () => {
      console.log('送信機との同期に成功しました！');
      updateStatus('viewer', '同期完了 (リアルタイム受信中)');
    });

    p2pConnection.on('data', (payload) => {
      // Draw visualizer using the P2P payload
      drawVisualizer(payload.data, payload.sampleRate, true);
      
      const rateInfo = document.getElementById('sampling-rate-info');
      if (rateInfo) {
        rateInfo.textContent = `受信動作レート: ${payload.sampleRate.toLocaleString()} Hz | 同期状態: 良好`;
      }
    });

    p2pConnection.on('close', () => {
      console.warn('送信機との同期が切れました。再接続します。');
      updateStatus('viewer', '送信機との接続が切れました。再起動中...');
      setTimeout(startViewerMode, 2000);
    });

    p2pConnection.on('error', (err) => {
      console.error('P2P接続エラー:', err);
      setTimeout(startViewerMode, 2000);
    });
  });

  peer.on('error', (err) => {
    console.error('PeerJS 受信エラー:', err);
    // If the sender is not active, keep looking for it
    setTimeout(startViewerMode, 3000);
  });
}

function destroyPeer() {
  if (p2pConnection) {
    try { p2pConnection.close(); } catch(e) {}
    p2pConnection = null;
  }
  
  activeConnections.forEach(conn => {
    try { conn.close(); } catch(e) {}
  });
  activeConnections = [];

  if (peer) {
    try { peer.destroy(); } catch(e) {}
    peer = null;
  }
}

// ==========================================
// 2. Canvas Spectrum Rendering
// ==========================================

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawVisualizer(dataArray, sampleRate, isPreSliced = false) {
  const width = canvas.width / window.devicePixelRatio;
  const height = canvas.height / window.devicePixelRatio;
  
  ctx.clearRect(0, 0, width, height);
  
  const leftMargin = 42;
  const rightMargin = 10;
  const bottomMargin = 4;
  const innerWidth = width - leftMargin - rightMargin;
  const innerHeight = height - bottomMargin;
  
  let numRenderedBins;
  let startBin = 0;
  let binWidth = 0;
  
  if (isPreSliced) {
    numRenderedBins = dataArray.length;
    binWidth = (sampleRate / 2) / (dataArray.length * (sampleRate / 2 / (20000 - 10000)));
  } else {
    const totalBins = dataArray.length;
    binWidth = (sampleRate / 2) / totalBins;
    
    // Zoom range (10,000 Hz to 20,000 Hz)
    const startHz = 10000;
    const endHz = 20000;
    
    startBin = Math.max(0, Math.floor(startHz / binWidth));
    const endBin = Math.min(totalBins - 1, Math.ceil(endHz / binWidth));
    numRenderedBins = endBin - startBin + 1;
  }
  
  const barWidth = innerWidth / numRenderedBins;
  
  // 1. Draw Y-axis grid lines and labels (decibels)
  const dbLevels = [-90, -75, -60, -45, -30, -15];
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  
  dbLevels.forEach(db => {
    const ratio = (db - (-90)) / (-15 - (-90));
    const y = innerHeight - (ratio * innerHeight);
    
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(width - rightMargin, y);
    ctx.stroke();
    
    ctx.fillText(`${db} dB`, leftMargin - 6, y);
  });

  // 2. Find Peak Frequency in range
  let peakDb = -Infinity;
  let peakBinIndex = -1;
  for (let i = 0; i < numRenderedBins; i++) {
    const db = dataArray[isPreSliced ? i : startBin + i];
    if (db > peakDb) {
      peakDb = db;
      peakBinIndex = i;
    }
  }
  
  let peakHz = 0;
  if (isPreSliced) {
    peakHz = 10000 + Math.round(peakBinIndex * (10000 / numRenderedBins));
  } else if (peakBinIndex !== -1) {
    peakHz = Math.round((startBin + peakBinIndex) * binWidth);
  }
  
  // 3. Draw smooth filled area curve
  ctx.beginPath();
  ctx.moveTo(leftMargin, innerHeight);
  for (let i = 0; i < numRenderedBins; i++) {
    const db = dataArray[isPreSliced ? i : startBin + i];
    const barHeight = Math.max(0, ((db - (-90)) / (-15 - (-90))) * innerHeight);
    const x = leftMargin + i * barWidth;
    const y = innerHeight - barHeight;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(leftMargin + (numRenderedBins - 1) * barWidth, innerHeight);
  ctx.closePath();
  
  const fillGrad = ctx.createLinearGradient(0, innerHeight, 0, 0);
  fillGrad.addColorStop(0.0, 'rgba(0, 240, 255, 0.02)');
  fillGrad.addColorStop(0.5, 'rgba(0, 255, 102, 0.08)');
  fillGrad.addColorStop(1.0, 'rgba(255, 0, 85, 0.15)');
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // 4. Draw thick glowing stroke outline
  ctx.strokeStyle = '#00ff66';
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 6;
  ctx.shadowColor = 'rgba(0, 255, 102, 0.5)';
  
  ctx.beginPath();
  for (let i = 0; i < numRenderedBins; i++) {
    const db = dataArray[isPreSliced ? i : startBin + i];
    const barHeight = Math.max(0, ((db - (-90)) / (-15 - (-90))) * innerHeight);
    const x = leftMargin + i * barWidth;
    const y = innerHeight - barHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 5. Draw Peak Tracker Guideline
  if (peakDb > -75 && peakBinIndex !== -1) {
    const peakX = leftMargin + peakBinIndex * barWidth;
    const peakRatio = (peakDb - (-90)) / (-15 - (-90));
    const peakY = innerHeight - (peakRatio * innerHeight);
    
    ctx.strokeStyle = 'rgba(255, 235, 59, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(peakX, 0);
    ctx.lineTo(peakX, innerHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.arc(peakX, peakY, 4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#ffeb3b';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = peakX > width - 100 ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    
    const offsetLabelX = peakX > width - 100 ? -8 : 8;
    ctx.fillText(`ピーク: ${peakHz.toLocaleString()} Hz (${peakDb.toFixed(1)} dB)`, peakX + offsetLabelX, peakY - 4);
  }
}

// Bind local microphone progress callback
analyzer.onProgress = (dataArray, sampleRate) => {
  drawVisualizer(dataArray, sampleRate, false);
  
  // Streaming: If there are active viewer connections, broadcast the FFT slice
  if (currentRole === 'sender' && activeConnections.length > 0) {
    sendThrottleCount++;
    if (sendThrottleCount % 2 === 0) {
      const totalBins = dataArray.length;
      const binWidth = (sampleRate / 2) / totalBins;
      const startHz = 10000;
      const endHz = 20000;
      const startBin = Math.max(0, Math.floor(startHz / binWidth));
      const endBin = Math.min(totalBins - 1, Math.ceil(endHz / binWidth));
      
      const slicedArray = Array.from(dataArray.slice(startBin, endBin + 1));
      
      const payload = {
        data: slicedArray,
        sampleRate: sampleRate
      };

      activeConnections.forEach(conn => {
        if (conn.open) {
          conn.send(payload);
        }
      });
    }
  }
};

// ==========================================
// 3. Start / Stop Controller (Mic Listener)
// ==========================================

async function toggleListening() {
  const rateInfo = document.getElementById('sampling-rate-info');
  if (isListening) {
    isListening = false;
    btnToggleListen.innerHTML = '<span class="btn-icon">⚡</span> 測定開始 (マイク起動)';
    btnToggleListen.classList.remove('listening');
    analyzer.stop();
    if (rateInfo) {
      rateInfo.textContent = 'マイク送信機: 待機中...';
    }
  } else {
    try {
      btnToggleListen.disabled = true;
      btnToggleListen.textContent = '起動中...';
      
      await analyzer.startMicrophone();
      
      isListening = true;
      btnToggleListen.disabled = false;
      btnToggleListen.innerHTML = '<span class="btn-icon">⏹️</span> 停止';
      btnToggleListen.classList.add('listening');
      
      if (rateInfo && analyzer.sampleRate) {
        rateInfo.textContent = `マイク動作レート: ${analyzer.sampleRate.toLocaleString()} Hz | 同調待機中...`;
      }
    } catch (err) {
      btnToggleListen.disabled = false;
      btnToggleListen.innerHTML = '<span class="btn-icon">⚡</span> 測定開始 (マイク起動)';
      
      let errorMsg = 'マイクへのアクセスが拒否されたか、デバイスで利用できません。マイクの権限を許可してください。';
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        errorMsg += '\n\n【重要】スマートフォンで接続する場合、セキュア接続(HTTPS)が必要です。URLの先頭が「https://」になっていることを確認してください。';
      }
      alert(errorMsg);
    }
  }
}

btnToggleListen.addEventListener('click', toggleListening);

// ==========================================
// 4. Bootstrap App
// ==========================================
// Auto-start role negotiation
autoNegotiateRole();
