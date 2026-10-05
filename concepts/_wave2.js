  (function () {
    const ns = 'http://www.w3.org/2000/svg'
    const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const el = (name, attrs) => { const n = document.createElementNS(ns, name); for (const k in attrs) n.setAttribute(k, attrs[k]); return n }

    const genPoints = (seed) => {
      const rnd = mulberry(((seed * 2654435761) >>> 0) || 1)
      const n = 11 + Math.floor(rnd() * 7)
      const ys = []
      let y = 168 + rnd() * 26
      for (let i = 0; i < n; i++) {
        ys.push(y)
        y += rnd() * 58 - 27
        y = Math.min(212, Math.max(38, y))
      }
      ys[n - 1] = Math.max(30, ys[0] - 28 - rnd() * 46)
      return ys.map((v, i) => [-10 + (1100 / (n - 1)) * i, v])
    }

    const smooth = (p) => {
      let d = `M ${p[0][0]},${p[0][1]}`
      for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2
        d += ` C ${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
      }
      return d
    }

    const renders = {
      line: (svg, pts) => {
        const d = smooth(pts)
        svg.appendChild(el('path', { d: `${d} L 1090,260 L -10,260 Z`, fill: 'url(#areaFade)' }))
        svg.appendChild(el('path', { d, fill: 'none', stroke: 'url(#strokeFade)', 'stroke-width': 4 }))
      },
      step: (svg, pts) => {
        let d = `M ${pts[0][0]},${pts[0][1]}`
        for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]},${pts[i - 1][1]} L ${pts[i][0]},${pts[i][1]}`
        svg.appendChild(el('path', { d: `${d} L 1090,260 L -10,260 Z`, fill: 'url(#areaFade)' }))
        svg.appendChild(el('path', { d, fill: 'none', stroke: '#ea580c', 'stroke-width': 4 }))
      },
      bars: (svg, pts) => {
        const w = (pts[1][0] - pts[0][0]) * 0.62
        const tallest = Math.min(...pts.map(p => p[1]))
        pts.forEach((p, i) => {
          const accent = i === pts.length - 1 || p[1] === tallest
          svg.appendChild(el('rect', { x: p[0] - w / 2, width: w, y: p[1], height: 260 - p[1], fill: accent ? '#ea580c' : '#111827', opacity: accent ? 0.75 : 0.15 }))
        })
      },
    }

    document.querySelectorAll('svg[data-wave]').forEach(svg => {
      renders[svg.getAttribute('data-wave')](svg, genPoints(+svg.getAttribute('data-seed')))
    })
  })()
</script>
</body>
