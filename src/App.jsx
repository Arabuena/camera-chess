

import { useRef, useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

// Caminho do OpenCV.js instalado via npm (opencv.js)
const OPENCV_URL = 'node_modules/opencv.js/opencv.js';


function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [error, setError] = useState(null);
  const [cvLoaded, setCvLoaded] = useState(false);
  const [loadingCv, setLoadingCv] = useState(false);
  const prevFrameRef = useRef(null); // Para armazenar o frame anterior
  const [chess] = useState(() => new Chess());
  const [fen, setFen] = useState('start');

  // Carregar OpenCV.js
  useEffect(() => {
    setLoadingCv(true);
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.x/opencv.js'; // CDN oficial
    script.async = true;
    script.onload = () => {
      // Aguarda o OpenCV carregar globalmente
      if (window.cv && window.cv.Mat) {
        setCvLoaded(true);
        setLoadingCv(false);
      } else {
        // fallback: espera até cv estar disponível
        const check = setInterval(() => {
          if (window.cv && window.cv.Mat) {
            setCvLoaded(true);
            setLoadingCv(false);
            clearInterval(check);
          }
        }, 100);
      }
    };
    script.onerror = () => {
      setError('Falha ao carregar OpenCV.js');
      setLoadingCv(false);
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // Captura de vídeo
  useEffect(() => {
    async function getCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        setError('Não foi possível acessar a câmera.');
      }
    }
    getCamera();
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);


  // Captura frame do vídeo, desenha no canvas e detecta linhas (grade)
  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current || !window.cv) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0, 480, 360);

    // Processamento OpenCV.js
    const src = window.cv.imread(canvasRef.current);
    const gray = new window.cv.Mat();
    window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
    const blur = new window.cv.Mat();
    window.cv.GaussianBlur(gray, blur, new window.cv.Size(5, 5), 0, 0, window.cv.BORDER_DEFAULT);
    const edges = new window.cv.Mat();
    window.cv.Canny(blur, edges, 50, 150, 3, false);
    const lines = new window.cv.Mat();
    // HoughLinesP: detecta linhas retas
    window.cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 80, 40, 10);

    // Desenha as linhas detectadas sobre o canvas
    let detectedLines = [];
    for (let i = 0; i < lines.rows; ++i) {
      const [x1, y1, x2, y2] = lines.data32S.slice(i * 4, i * 4 + 4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.stroke();
      detectedLines.push({ x1, y1, x2, y2 });
    }

    // Detectar interseções entre todas as linhas
    function getIntersection(line1, line2) {
      const { x1, y1, x2, y2 } = line1;
      const { x1: x3, y1: y3, x2: x4, y2: y4 } = line2;
      const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (denom === 0) return null; // paralelas
      const px = ((x1*y2 - y1*x2)*(x3 - x4) - (x1 - x2)*(x3*y4 - y3*x4)) / denom;
      const py = ((x1*y2 - y1*x2)*(y3 - y4) - (y1 - y2)*(x3*y4 - y3*x4)) / denom;
      // Verifica se o ponto está dentro dos segmentos
      function between(a, b, c) { return a >= Math.min(b, c) - 2 && a <= Math.max(b, c) + 2; }
      if (
        between(px, x1, x2) && between(px, x3, x4) &&
        between(py, y1, y2) && between(py, y3, y4)
      ) {
        return { x: px, y: py };
      }
      return null;
    }

    let intersections = [];
    for (let i = 0; i < detectedLines.length; i++) {
      for (let j = i + 1; j < detectedLines.length; j++) {
        const pt = getIntersection(detectedLines[i], detectedLines[j]);
        if (pt) intersections.push(pt);
      }
    }


    // Agrupa interseções próximas (clustering simples)
    function clusterPoints(points, dist = 12) {
      const clusters = [];
      points.forEach(pt => {
        let found = false;
        for (const cluster of clusters) {
          const dx = pt.x - cluster.x;
          const dy = pt.y - cluster.y;
          if (Math.sqrt(dx*dx + dy*dy) < dist) {
            // média incremental
            cluster.x = (cluster.x * cluster.count + pt.x) / (cluster.count + 1);
            cluster.y = (cluster.y * cluster.count + pt.y) / (cluster.count + 1);
            cluster.count++;
            found = true;
            break;
          }
        }
        if (!found) clusters.push({ x: pt.x, y: pt.y, count: 1 });
      });
      return clusters;
    }

    const clustered = clusterPoints(intersections);

    // Desenha círculos nas interseções agrupadas
    clustered.forEach(({ x, y }) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = 'lime';
      ctx.fill();
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Se houver 81 pontos (9x9), desenha centros das casas e detecta mudanças
    if (clustered.length === 81) {
      // Ordena por y, depois por x
      const sorted = [...clustered].sort((a, b) => a.y - b.y || a.x - b.x);
      // Agrupa por linhas
      const rows = [];
      for (let i = 0; i < 9; i++) {
        rows.push(sorted.slice(i * 9, (i + 1) * 9).sort((a, b) => a.x - b.x));
      }
      // Salva centros das casas
      const cellCenters = [];
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          const p1 = rows[i][j];
          const p2 = rows[i+1][j+1];
          const cx = (p1.x + p2.x) / 2;
          const cy = (p1.y + p2.y) / 2;
          cellCenters.push({ cx, cy });
        }
      }
      // Detecta mudanças nas casas
      let changedCells = [];
      if (prevFrameRef.current) {
        const prev = prevFrameRef.current;
        for (let idx = 0; idx < cellCenters.length; idx++) {
          const { cx, cy } = cellCenters[idx];
          // Pega pixel do frame atual
          const curPixel = ctx.getImageData(cx, cy, 1, 1).data;
          // Pega pixel do frame anterior
          const prevPixel = prev.getImageData(cx, cy, 1, 1).data;
          // Calcula diferença (simples: soma das diferenças absolutas RGB)
          const diff = Math.abs(curPixel[0] - prevPixel[0]) + Math.abs(curPixel[1] - prevPixel[1]) + Math.abs(curPixel[2] - prevPixel[2]);
          if (diff > 60) changedCells.push(idx);
        }
        // Se exatamente 2 casas mudaram, tenta converter em lance
        if (changedCells.length === 2) {
          // Mapeia idx para notação algebraica
          const idxToAlg = idx => {
            const file = String.fromCharCode(97 + (idx % 8));
            const rank = 8 - Math.floor(idx / 8);
            return file + rank;
          };
          const [fromIdx, toIdx] = changedCells;
          const move = { from: idxToAlg(fromIdx), to: idxToAlg(toIdx) };
          const result = chess.move(move);
          if (result) setFen(chess.fen());
        }
      }
      // Desenha centros das casas
      for (let idx = 0; idx < cellCenters.length; idx++) {
        const { cx, cy } = cellCenters[idx];
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
        if (changedCells.includes(idx)) {
          ctx.fillStyle = 'yellow';
        } else {
          ctx.fillStyle = 'blue';
          ctx.globalAlpha = 0.5;
        }
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
      // Salva frame atual para próxima comparação
      const newFrame = document.createElement('canvas');
      newFrame.width = 480;
      newFrame.height = 360;
      newFrame.getContext('2d').drawImage(canvasRef.current, 0, 0);
      prevFrameRef.current = newFrame.getContext('2d');
    }

    // Libera memória
    src.delete();
    gray.delete();
    blur.delete();
    edges.delete();
    lines.delete();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 32 }}>
      <h1>Camera Chess MVP</h1>
      <p>Captura de vídeo para detecção do tabuleiro</p>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 32 }}>
        <div>
          <video
            ref={videoRef}
            width={480}
            height={360}
            autoPlay
            playsInline
            style={{ border: '2px solid #333', borderRadius: 8, marginBottom: 16 }}
          />
          <canvas
            ref={canvasRef}
            width={480}
            height={360}
            style={{ border: '2px solid #888', borderRadius: 8, marginBottom: 16, display: 'block' }}
          />
          <button
            onClick={handleCapture}
            disabled={!cvLoaded || loadingCv}
            style={{ marginBottom: 16 }}
          >
            {loadingCv ? 'Carregando OpenCV...' : 'Capturar Frame'}
          </button>
        </div>
        <div>
          <Chessboard position={fen} boardWidth={360} />
          <div style={{ marginTop: 12, fontSize: 12, color: '#444' }}>
            <b>FEN:</b> <span style={{ wordBreak: 'break-all' }}>{fen}</span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 24, color: '#888' }}>
        <small>
          {cvLoaded
            ? 'OpenCV.js carregado! Pronto para detectar a grade do tabuleiro.'
            : 'Aguardando OpenCV.js...'}
        </small>
      </div>
    </div>
  );
}

export default App;
