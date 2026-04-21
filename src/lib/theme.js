const THEMES = {
  dcb: {
    '--brand':       '#CC9933',
    '--brand-light': '#E4A853',
    '--brand-pale':  '#FFF8EC',
    '--bg':          '#F7F3EC',
    '--border':      '#D9CEB8',
    '--text':        '#2C2416',
    '--text-muted':  '#8C7B65',
    '--header-bg':   '#EAE3D4',
    '--header-border':'#CC9933',
  },
  lauian: {
    '--brand':       '#6B7A2E',
    '--brand-light': '#849936',
    '--brand-pale':  '#F2F4E6',
    '--bg':          '#F4F5EC',
    '--border':      '#C8CCA0',
    '--text':        '#1E2010',
    '--text-muted':  '#6B7040',
    '--header-bg':   '#E2E5C8',
    '--header-border':'#6B7A2E',
  },
  bordeaux: {
    '--brand':       '#8B3A3A',
    '--brand-light': '#A84848',
    '--brand-pale':  '#F8ECEC',
    '--bg':          '#F7F2F2',
    '--border':      '#D9B8B8',
    '--text':        '#241616',
    '--text-muted':  '#8C6565',
    '--header-bg':   '#EAD4D4',
    '--header-border':'#8B3A3A',
  },
}

export function applyTheme(agence) {
  const theme = THEMES[agence] || THEMES.dcb
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme)) {
    root.style.setProperty(key, value)
  }
}
