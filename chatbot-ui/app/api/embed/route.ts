export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')

    if (!key) {
        return new Response('console.error("Missing Chatbot API Key");', {
            headers: { 'Content-Type': 'application/javascript' }
        })
    }

    // Define the base URL of the Next.js app 
    // Normally this would be dynamic based on the request host, but for MVP local testing we use localhost:3001
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
    const iframeUrl = `${appUrl}/widget/embed?key=${key}`

    const jsCode = `
(function() {
  // Prevent multiple injections
  if (document.getElementById('saas-chatbot-widget-container')) return;

  // Create container
  const container = document.createElement('div');
  container.id = 'saas-chatbot-widget-container';
  container.style.position = 'fixed';
  container.style.bottom = '20px';
  container.style.right = '20px';
  container.style.zIndex = '999999';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'flex-end';
  container.style.fontFamily = 'system-ui, -apple-system, sans-serif';

  // Create iframe wrapper (hidden by default)
  const iframeWrapper = document.createElement('div');
  iframeWrapper.id = 'saas-chatbot-iframe-wrapper';
  iframeWrapper.style.display = 'none';
  iframeWrapper.style.width = '380px';
  iframeWrapper.style.height = '600px';
  iframeWrapper.style.maxWidth = 'calc(100vw - 40px)';
  iframeWrapper.style.maxHeight = 'calc(100vh - 100px)';
  iframeWrapper.style.borderRadius = '16px';
  iframeWrapper.style.boxShadow = '0 10px 40px -10px rgba(0,0,0,0.2)';
  iframeWrapper.style.overflow = 'hidden';
  iframeWrapper.style.marginBottom = '16px';
  iframeWrapper.style.backgroundColor = '#fff';
  iframeWrapper.style.transition = 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
  iframeWrapper.style.opacity = '0';
  iframeWrapper.style.transform = 'translateY(20px) scale(0.95)';
  iframeWrapper.style.pointerEvents = 'none';

  // Create iframe
  const iframe = document.createElement('iframe');
  iframe.src = '${iframeUrl}';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframeWrapper.appendChild(iframe);

  // Create toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'saas-chatbot-toggle-btn';
  toggleBtn.style.width = '60px';
  toggleBtn.style.height = '60px';
  toggleBtn.style.borderRadius = '30px';
  toggleBtn.style.backgroundColor = '#2563eb';
  toggleBtn.style.color = '#fff';
  toggleBtn.style.border = 'none';
  toggleBtn.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.4)';
  toggleBtn.style.cursor = 'pointer';
  toggleBtn.style.display = 'flex';
  toggleBtn.style.justifyContent = 'center';
  toggleBtn.style.alignItems = 'center';
  toggleBtn.style.transition = 'transform 0.2s, background-color 0.2s';
  toggleBtn.style.padding = '0';
  
  // Icon inside button (Chat icon by default, Close icon when open)
  const chatIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  const closeIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  
  toggleBtn.innerHTML = chatIcon;

  // Toggle Logic
  let isOpen = false;
  toggleBtn.onclick = () => {
    isOpen = !isOpen;
    if (isOpen) {
      iframeWrapper.style.display = 'block';
      // Use setTimeout to allow display:block to apply before animating opacity
      setTimeout(() => {
        iframeWrapper.style.opacity = '1';
        iframeWrapper.style.transform = 'translateY(0) scale(1)';
        iframeWrapper.style.pointerEvents = 'auto';
      }, 10);
      toggleBtn.innerHTML = closeIcon;
      toggleBtn.style.backgroundColor = '#1e40af';
      toggleBtn.style.transform = 'scale(0.9)';
      setTimeout(() => toggleBtn.style.transform = 'scale(1)', 150);
    } else {
      iframeWrapper.style.opacity = '0';
      iframeWrapper.style.transform = 'translateY(20px) scale(0.95)';
      iframeWrapper.style.pointerEvents = 'none';
      setTimeout(() => {
        iframeWrapper.style.display = 'none';
      }, 300); // Wait for transition
      toggleBtn.innerHTML = chatIcon;
      toggleBtn.style.backgroundColor = '#2563eb';
    }
  };

  // Hover effects
  toggleBtn.onmouseover = () => {
    if (!isOpen) toggleBtn.style.transform = 'scale(1.05)';
  };
  toggleBtn.onmouseout = () => {
    toggleBtn.style.transform = 'scale(1)';
  };

  // Assemble
  container.appendChild(iframeWrapper);
  container.appendChild(toggleBtn);
  document.body.appendChild(container);
})();
`

    return new Response(jsCode, {
        headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'public, max-age=3600'
        }
    })
}
