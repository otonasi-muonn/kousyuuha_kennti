import { AudioAnalyzer } from './analyzer.js';

// Instantiate the analyzer
const analyzer = new AudioAnalyzer();

// DOM elements
const btnToggleListen = document.getElementById('btn-toggle-listen');
const canvas = document.getElementById('visualizer-canvas');
const ctx = canvas.getContext('2d');

// Role Switcher buttons
const btnRoleSender = document.getElementById('btn-role-sender');
const btnRoleViewer = document.getElementById('btn-role-viewer');

// P2P UI Elements
const panelSenderInfo = document.getElementById('panel-sender-info');
const panelViewerInput = document.getElementById('panel-viewer-input');
const valRoomId = document.getElementById('val-room-id');
const inputConnectId = document.getElementById('input-connect-id');
const btnConnectPeer = document.getElementById('btn-connect-peer');

// State
let isListening = false;
let currentRole = 'sender'; // 'sender' | 'viewer'
let sendThrottleCount = 0;

// PeerJS instances
let peer = null;
let activeConnections = []; // For Sender: list of connected viewer channels
let p2pConnection = null;   // For Viewer: connection to the sender

// ==========================================
// 1. PeerJS WebRTC P2P Sync
// ==========================================

// Initialize PeerJS for Sender
function initSenderPeer(code = null) {
  destroyPeer();

  // Generate a random 4-digit code if not provided
  if (!code) {
    code = Math.floor(1000 + Math.random() * 9000);
  }
  
  valRoomId.textContent = code;
  const peerId = `aurasonic-${code}`;

  // Connect to the free public PeerJS cloud signaling server
  peer = new Peer(peerId);

  peer.on('open', (id) => {
    console.log('送信機のP2Pホストを開始しました:', id);
    const rateInfo = document.getElementById('sampling-rate-info');
    if (rateInfo) rateInfo.textContent = 'マイク送信機: P2P待機中...';
  });

  peer.on('connection', (conn) => {
    console.log('受信機が接続しました:', conn.peer);
    
    // Add to active connections
    activeConnections.push(conn);
    
    const rateInfo = document.getElementById('sampling-rate-info');
    if (rateInfo) rateInfo.textContent = `送信中 (接続済み受信機: ${activeConnections.length}台)`;

    conn.on('close', () => {
      activeConnections = activeConnections.filter(c => c !== conn);
      if (rateInfo) {
        rateInfo.textContent = activeConnections.length > 0 
          ? `送信中 (接続済み受信機: ${activeConnections.length}台)` 
          : 'マイク送信機: P2P待機中...';
      }
    });
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // 4-digit code is already taken globally on PeerJS cloud, retry with another code
      console.warn('IDが既に使用されています。新しいコードで再試行します。');
      const newCode = Math.floor(1000 + Math.random() * 9000);
      initSenderPeer(newCode);
    } else {
      console.error('PeerJS 送信エラー:', err);
    }
  });
}

// Initialize PeerJS for Viewer and connect to Sender
function connectToSender(targetCode) {
  destroyPeer();

  if (!targetCode || targetCode.length !== 4) {
    alert('4桁の数値を入力してください。');
    return;
  }

  btnConnectPeer.disabled = true;
  btnConnectPeer.textContent = '接続中...';
  
  // Initialize viewer peer with a random ID
  peer = new Peer();

  peer.on('open', (id) => {
    console.log('受信機のP2Pを起動しました:', id);
    const targetPeerId = `aurasonic-${targetCode}`;
    
    // Connect to the sender
    p2pConnection = peer.connect(targetPeerId);

    p2pConnection.on('open', () => {
      console.log('送信機との同期接続に成功しました！');
      btnConnectPeer.disabled = false;
      btnConnectPeer.textContent = '同期完了';
      btnConnectPeer.style.background = 'linear-gradient(135deg, #0072ff 0%, #00c6ff 100%)';
      
      btnToggleListen.innerHTML = '<span class="btn-icon">📶</span> データ受信中 (同期完了)';
      btnToggleListen.className = 'btn-start listening';
      btnToggleListen.disabled = true;
      
      const rateInfo = document.getElementById('sampling-rate-info');
      if (rateInfo) rateInfo.textContent = '手元受信モード: 送信機と同期中';
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
      console.warn('送信機との接続が切れました。');
      handleViewerDisconnect();
    });
    
    p2pConnection.on('error', (err) => {
      console.error('P2P接続エラー:', err);
      handleViewerDisconnect();
    });
  });

  peer.on('error', (err) => {
    console.error('PeerJS 受信エラー:', err);
    alert('送信機の接続コードが見つかりません。番号が正しいか確認してください。');
    handleViewerDisconnect();
  });
}

function handleViewerDisconnect() {
  btnConnectPeer.disabled = false;
  btnConnectPeer.textContent = '同期接続';
  btnConnectPeer.style.background = '';
  
  btnToggleListen.innerHTML = '<span class="btn-icon">⚡</span> 接続待機中';
  btnToggleListen.className = 'btn-start';
  btnToggleListen.disabled = true;
  
  const rateInfo = document.getElementById('sampling-rate-info');
  if (rateInfo) rateInfo.textContent = '手元受信モード: 切断されました。再接続してください。';
  
  destroyPeer();
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
    // Throttle to ~30fps (every 2 frames) to save mobile device resources
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
      rateInfo.textContent = 'マイク送信機: P2P待機中...';
    }
  } else {
    try {
      btnToggleListen.disabled = true;
      btnToggleListen.textContent = '接続中...';
      
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
// 4. Role Selector Event Handlers
// ==========================================

btnRoleSender.addEventListener('click', () => {
  if (currentRole === 'sender') return;
  
  currentRole = 'sender';
  btnRoleSender.classList.add('active');
  btnRoleViewer.classList.remove('active');
  
  panelSenderInfo.classList.remove('hidden');
  panelViewerInput.classList.add('hidden');
  
  // Reset P2P connections
  destroyPeer();
  ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
  
  // Show standard sender controls
  btnToggleListen.disabled = false;
  btnToggleListen.innerHTML = '<span class="btn-icon">⚡</span> 測定開始 (マイク起動)';
  btnToggleListen.className = 'btn-start';
  
  const rateInfo = document.getElementById('sampling-rate-info');
  if (rateInfo) rateInfo.textContent = 'マイク送信機: P2P待機中...';
  
  // Startup P2P Sender
  initSenderPeer();
});

btnRoleViewer.addEventListener('click', () => {
  if (currentRole === 'viewer') return;
  
  currentRole = 'viewer';
  btnRoleViewer.classList.add('active');
  btnRoleSender.classList.remove('active');
  
  panelSenderInfo.classList.add('hidden');
  panelViewerInput.classList.remove('hidden');
  
  // Stop mic if it was listening
  if (isListening) {
    isListening = false;
    analyzer.stop();
  }
  
  destroyPeer();
  ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
  
  // Update control button to show sync mode
  btnToggleListen.disabled = true;
  btnToggleListen.innerHTML = '<span class="btn-icon">⚡</span> 接続コード入力待ち';
  btnToggleListen.className = 'btn-start';
  
  const rateInfo = document.getElementById('sampling-rate-info');
  if (rateInfo) rateInfo.textContent = '手元受信モード: コードを入力して接続ボタンを押してください。';
});

// Bind Connect Button (Viewer)
btnConnectPeer.addEventListener('click', () => {
  const code = inputConnectId.value.trim();
  if (code.length === 4) {
    connectToSender(code);
  } else {
    alert('送信機画面に表示されている4桁の数字を入力してください。');
  }
});

// ==========================================
// 5. Bootstrap App
// ==========================================
// Auto init sender peer on startup
initSenderPeer();
