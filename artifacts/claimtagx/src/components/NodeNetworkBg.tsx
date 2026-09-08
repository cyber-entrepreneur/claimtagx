import { useEffect, useRef } from 'react';

// Animated custody-chain background — drifting nodes connected by faint lime
// lines. The visual metaphor: every node is a handoff, every line is a custody
// link. Designed to sit behind hero content as ambient atmosphere, not focal.
//
// Performance: respects prefers-reduced-motion (renders one static frame),
// pauses entirely when the canvas is offscreen (saves the laptop fan when a
// visitor scrolls down).

interface NodeNetworkBgProps {
  /** Override node count. Defaults to 70 — same as the design mockup. */
  nodeCount?: number;
  /** Max distance in px between nodes to draw a connecting line. */
  linkDistance?: number;
  /** Tailwind classes for positioning. Defaults absolute inset-0. */
  className?: string;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export default function NodeNetworkBg({
  nodeCount = 70,
  linkDistance = 180,
  className = 'absolute inset-0 pointer-events-none',
}: NodeNetworkBgProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let nodes: Node[] = [];
    let rafId = 0;
    let visible = true;

    function sizeCanvas() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seedNodes() {
      const rect = canvas!.getBoundingClientRect();
      nodes = Array.from({ length: nodeCount }, () => ({
        x: Math.random() * rect.width,
        y: Math.random() * rect.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.5 + 0.5,
      }));
    }

    function draw() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Drift first so positions are settled before drawing.
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > rect.width) n.vx *= -1;
        if (n.y < 0 || n.y > rect.height) n.vy *= -1;
      }

      // Connecting lines — drawn first so nodes sit on top.
      ctx.strokeStyle = 'rgba(198, 242, 78, 0.12)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkDistance * linkDistance) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Nodes
      ctx.fillStyle = 'rgba(198, 242, 78, 0.28)';
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop() {
      if (visible) draw();
      rafId = requestAnimationFrame(loop);
    }

    sizeCanvas();
    seedNodes();

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const e2eStable = document.documentElement.dataset.e2eStable === '1';
    if (prefersReduced || e2eStable) {
      draw();
      return;
    }

    // Pause animation when offscreen — saves CPU when the visitor scrolls past
    // the hero.
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const onResize = () => {
      sizeCanvas();
      seedNodes();
    };
    window.addEventListener('resize', onResize);

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      io.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [nodeCount, linkDistance]);

  // `block w-full h-full` forces the canvas to actually fill its parent —
  // otherwise the intrinsic 300×150 default sticks even with absolute inset-0.
  //
  // The mask fades the network at top and bottom so the lime dots and links
  // dissolve into the obsidian instead of slamming into the section boundary
  // (which produced a phosphor-band artifact at the hero/next-section seam).
  return (
    <canvas
      ref={canvasRef}
      className={`block w-full h-full ${className}`}
      style={{
        // Fade the network well before the section edges so no lime dots or
        // link lines render in the last quarter of the hero — that's what
        // produced the phosphor band at the section seam.
        maskImage:
          'linear-gradient(to bottom, transparent 0%, black 30%, black 65%, transparent 95%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, black 30%, black 65%, transparent 95%)',
      }}
      aria-hidden="true"
    />
  );
}
