/**
 * The Guardian - Safe Preview Controller
 * 
 * Handles 3-layer preview system:
 * 1. Metadata Security Scan (Layer 1)
 * 2. Static Page Preview (Layer 2) - Future
 * 3. Sandbox Rendering (Layer 3)
 */

// guardian-gateway -> scam (docker-compose :8090) — /safe-preview, /proxy, /health
const CONFIG = window.GUARDIAN_CONFIG || {
    SCAM_BASE_URL: 'http://localhost:8090/scam'
};
const API_BASE_URL = CONFIG.SCAM_BASE_URL;

// Get URL from query parameters
const urlParams = new URLSearchParams(window.location.search);
const targetUrl = urlParams.get('url');
const riskScore = urlParams.get('risk') || '0';
const status = urlParams.get('status') || 'unknown';
const scanId = urlParams.get('scanId');

// DOM elements
const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const errorMessage = document.getElementById('error-message');
const previewContent = document.getElementById('preview-content');
const retryBtn = document.getElementById('retry-btn');
const closeBtn = document.getElementById('close-btn');
const cancelBtn = document.getElementById('cancel-btn');
const openAnywayBtn = document.getElementById('open-anyway-btn');
const warningDialog = document.getElementById('warning-dialog');
const warningCancelBtn = document.getElementById('warning-cancel-btn');
const warningConfirmBtn = document.getElementById('warning-confirm-btn');

// Metadata elements
const metadataDomain = document.getElementById('metadata-domain');
const metadataHttps = document.getElementById('metadata-https');
const metadataIp = document.getElementById('metadata-ip');
const metadataRedirects = document.getElementById('metadata-redirects');
const metadataBlacklist = document.getElementById('metadata-blacklist');
const metadataTitle = document.getElementById('metadata-title');
const metadataDescription = document.getElementById('metadata-description');
const metadataFavicon = document.getElementById('metadata-favicon');

// Static preview elements
const staticPreviewPanel = document.getElementById('static-preview-panel');
const previewOgImage = document.getElementById('preview-og-image');
const previewImagePlaceholder = document.getElementById('preview-image-placeholder');
const previewFavicon = document.getElementById('preview-favicon');
const previewTitle = document.getElementById('preview-title');
const previewDescription = document.getElementById('preview-description');

// Cloudflare warning element
const cloudflareWarning = document.getElementById('cloudflare-warning');

// Sandbox elements
const sandboxPanel = document.getElementById('sandbox-panel');
const sandboxIframe = document.getElementById('sandbox-iframe');
const sandboxLoading = document.getElementById('sandbox-loading');
const sandboxError = document.getElementById('sandbox-error');
const sandboxStatus = document.getElementById('sandbox-status');

// Detailed log elements
const detailedLogPanel = document.getElementById('detailed-log-panel');

/**
 * Normalize URL - add https:// if missing
 */
function normalizeUrl(url) {
    if (!url) return null;
    url = url.trim();
    if (!url.match(/^https?:\/\//i)) {
        url = 'https://' + url;
    }
    return url;
}

/**
 * Fetch metadata from backend
 */
async function fetchMetadata(url) {
    console.log('[Safe Preview] fetchMetadata called with URL:', url);
    const normalizedUrl = normalizeUrl(url);
    console.log('[Safe Preview] Normalized URL:', normalizedUrl);
    
    if (!normalizedUrl) {
        console.error('[Safe Preview] Invalid URL format');
        return {
            error_type: "network_error",
            message: "Invalid URL format"
        };
    }

    try {
        const metadataUrl = `${API_BASE_URL}/safe-preview?url=${encodeURIComponent(normalizedUrl)}`;
        console.log('[Safe Preview] Fetching metadata from:', metadataUrl);
        
        const response = await fetch(metadataUrl);
        console.log('[Safe Preview] Metadata response status:', response.status, response.statusText);

        const contentType = (response.headers && response.headers.get)
            ? (response.headers.get('content-type') || '')
            : '';

        let rawBody = '';
        let data = null;

        // Parse defensively: servers/proxies sometimes return HTML error pages.
        if (contentType.toLowerCase().includes('application/json')) {
            try {
                data = await response.json();
            } catch (e) {
                // Fall back to text so we can show diagnostics.
                rawBody = await response.text();
            }
        } else {
            rawBody = await response.text();
            try {
                data = JSON.parse(rawBody);
            } catch (_) {
                data = null;
            }
        }

        if (data) {
            console.log('[Safe Preview] Metadata response data:', data);
        } else {
            const bodyPreview = (rawBody || '').trim().slice(0, 300);
            console.warn('[Safe Preview] Metadata returned non-JSON body. content-type:', contentType, 'body preview:', bodyPreview);

            // If the gateway returned HTML, it's usually an upstream/proxy error page.
            const looksLikeHtml = bodyPreview.startsWith('<!DOCTYPE') || bodyPreview.startsWith('<html') || bodyPreview.startsWith('<');
            if (!response.ok || looksLikeHtml) {
                let friendlyMessage = "Unable to connect to the website.";
                if (response.status >= 500) {
                    friendlyMessage = "The preview gateway returned an error (likely blocked or temporarily unavailable).";
                } else if (response.status === 404) {
                    friendlyMessage = "Preview endpoint not found. Check the gateway URL configuration.";
                } else if (response.status === 401 || response.status === 403) {
                    friendlyMessage = "The preview gateway blocked this request (auth/CORS/permissions).";
                }

                return {
                    error_type: response.status >= 500 ? "site_blocked" : "network_error",
                    message: friendlyMessage,
                    http_status: response.status,
                    content_type: contentType,
                    body_preview: bodyPreview
                };
            }
        }
        
        // Check if response contains an error
        if (data && data.error_type) {
            return data;  // Return structured error
        }
        
        // Check if response is not OK but doesn't have error_type
        if (!response.ok) {
            // Map HTTP status codes to friendly messages
            let friendlyMessage = "Unable to connect to the website.";
            if (response.status >= 500) {
                friendlyMessage = "The website blocked automated preview requests.";
            } else if (response.status === 404) {
                friendlyMessage = "The website was not found.";
            } else if (response.status === 403) {
                friendlyMessage = "The website blocked automated preview requests.";
            } else if (response.status === 408 || response.status === 504) {
                friendlyMessage = "The website took too long to respond.";
            }
            
            return {
                error_type: response.status >= 500 ? "site_blocked" : "network_error",
                message: friendlyMessage
            };
        }
        
        return data || {
            error_type: "network_error",
            message: "Preview gateway returned an unexpected response (non-JSON).",
            http_status: response.status,
            content_type: contentType
        };
    } catch (error) {
        console.error('[Safe Preview] ===== ERROR IN FETCH METADATA =====');
        console.error('[Safe Preview] Error type:', error.name);
        console.error('[Safe Preview] Error message:', error.message);
        console.error('[Safe Preview] Error stack:', error.stack);
        
        // Handle fetch errors (network issues, CORS, etc.)
        const errorMessage = error.message.toLowerCase();
        console.log('[Safe Preview] Error message (lowercase):', errorMessage);
        
        // Map technical errors to friendly messages
        let friendlyMessage = "Unable to connect to the website.";
        if (errorMessage.includes('getaddrinfo') || errorMessage.includes('name resolution')) {
            friendlyMessage = "Unable to resolve domain name.";
        } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
            friendlyMessage = "The website took too long to respond.";
        } else if (errorMessage.includes('failed to fetch') || errorMessage.includes('network')) {
            friendlyMessage = "Unable to connect to the website. Please check your internet connection and ensure guardian-gateway is running on http://localhost:8090.";
        }
        
        console.log('[Safe Preview] Returning error:', friendlyMessage);
        return {
            error_type: "network_error",
            message: friendlyMessage
        };
    }
}

/**
 * Display metadata in the UI
 */
function displayMetadata(data) {
    // Domain
    metadataDomain.textContent = data.domain || '-';
    
    // HTTPS Status
    if (data.protocol === 'https') {
        metadataHttps.innerHTML = '<span class="status-safe">✅ HTTPS (Secure)</span>';
    } else {
        metadataHttps.innerHTML = '<span class="status-warning">⚠️ HTTP (Not Secure)</span>';
    }
    
    // IP Address
    metadataIp.textContent = data.ip_address || 'Unable to resolve';
    
    // Redirect Count
    metadataRedirects.textContent = data.redirect_count || 0;
    
    // Blacklist Status
    const blacklistStatus = data.blacklist_status || 'unknown';
    if (blacklistStatus === 'blacklisted') {
        metadataBlacklist.innerHTML = '<span class="status-danger">🔴 Blacklisted</span>';
    } else if (blacklistStatus === 'suspicious') {
        metadataBlacklist.innerHTML = '<span class="status-warning">⚠️ Suspicious</span>';
    } else {
        metadataBlacklist.innerHTML = '<span class="status-safe">✅ Not Blacklisted</span>';
    }
    
    // Page Title
    metadataTitle.textContent = data.page_title || 'No title available';
    
    // Meta Description
    metadataDescription.textContent = data.meta_description || 'No description available';
    
    // Favicon
    if (data.favicon) {
        metadataFavicon.innerHTML = `<img src="${data.favicon}" alt="Favicon" onerror="this.style.display='none'"> ${data.favicon}`;
    } else {
        metadataFavicon.textContent = 'No favicon available';
    }
}

/**
 * Display static preview (Layer 2)
 */
function displayStaticPreview(data) {
    console.log('[Safe Preview] displayStaticPreview called with data:', data);
    
    // Show static preview panel
    staticPreviewPanel.style.display = 'block';
    
    // Try preview_image first (has better fallback chain), then og_image, then favicon
    const imageSources = [
        data.preview_image,  // Best: og:image → twitter:image → first <img> → favicon
        data.og_image,       // Fallback: just og:image
        data.favicon         // Last resort: favicon
    ].filter(Boolean); // Remove null/undefined values
    
    console.log('[Safe Preview] Available image sources:', imageSources);
    
    if (imageSources.length > 0) {
        // Try to load images in order until one succeeds
        let currentImageIndex = 0;
        
        const tryLoadImage = (imageUrl) => {
            console.log('[Safe Preview] Attempting to load image:', imageUrl);
            
            // Create a test image to check if it loads
            const testImg = new Image();
            
            testImg.onload = () => {
                console.log('[Safe Preview] Image loaded successfully:', imageUrl);
                previewOgImage.src = imageUrl;
                previewOgImage.style.display = 'block';
                previewImagePlaceholder.style.display = 'none';
            };
            
            testImg.onerror = () => {
                console.warn('[Safe Preview] Image failed to load:', imageUrl);
                // Try next image source
                currentImageIndex++;
                if (currentImageIndex < imageSources.length) {
                    tryLoadImage(imageSources[currentImageIndex]);
                } else {
                    // All images failed, show placeholder
                    console.log('[Safe Preview] All image sources failed, showing placeholder');
                    previewOgImage.style.display = 'none';
                    previewImagePlaceholder.style.display = 'flex';
                }
            };
            
            // Set crossOrigin to anonymous to avoid CORS issues (if supported)
            testImg.crossOrigin = 'anonymous';
            testImg.src = imageUrl;
        };
        
        // Also set up error handler on the actual image element
        previewOgImage.onerror = () => {
            console.warn('[Safe Preview] previewOgImage onerror fired');
            // Try next image source
            currentImageIndex++;
            if (currentImageIndex < imageSources.length) {
                tryLoadImage(imageSources[currentImageIndex]);
            } else {
                previewOgImage.style.display = 'none';
                previewImagePlaceholder.style.display = 'flex';
            }
        };
        
        // Start loading the first image
        tryLoadImage(imageSources[0]);
    } else {
        console.log('[Safe Preview] No image sources available');
        previewOgImage.style.display = 'none';
        previewImagePlaceholder.style.display = 'flex';
    }
    
    // Favicon - try multiple sources with fallback
    const faviconSources = [];
    if (data.favicon) {
        faviconSources.push(data.favicon);
    }
    // Try to extract domain from preview_image or og_image for default favicon
    if (data.preview_image || data.og_image) {
        try {
            const imageUrl = data.preview_image || data.og_image;
            const urlObj = new URL(imageUrl);
            faviconSources.push(`${urlObj.protocol}//${urlObj.host}/favicon.ico`);
        } catch (e) {
            // Invalid URL, skip
        }
    }
    
    if (faviconSources.length > 0) {
        let faviconIndex = 0;
        const tryLoadFavicon = (faviconUrl) => {
            const testFavicon = new Image();
            testFavicon.onload = () => {
                previewFavicon.src = faviconUrl;
                previewFavicon.style.display = 'block';
            };
            testFavicon.onerror = () => {
                faviconIndex++;
                if (faviconIndex < faviconSources.length) {
                    tryLoadFavicon(faviconSources[faviconIndex]);
                } else {
                    previewFavicon.style.display = 'none';
                }
            };
            testFavicon.crossOrigin = 'anonymous';
            testFavicon.src = faviconUrl;
        };
        
        previewFavicon.onerror = () => {
            faviconIndex++;
            if (faviconIndex < faviconSources.length) {
                tryLoadFavicon(faviconSources[faviconIndex]);
            } else {
                previewFavicon.style.display = 'none';
            }
        };
        
        tryLoadFavicon(faviconSources[0]);
    } else {
        previewFavicon.style.display = 'none';
    }
    
    // Page Title
    previewTitle.textContent = data.page_title || 'No title available';
    
    // Meta Description
    previewDescription.textContent = data.meta_description || 'No description available';
}

/**
 * Check if backend server is running
 */
async function checkBackendHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`, { 
            method: 'GET',
            signal: AbortSignal.timeout(3000) // 3 second timeout
        });
        
        if (!response.ok) {
            return false;
        }
        
        // Verify response contains status: "ok" (defensive parse)
        const contentType = (response.headers && response.headers.get)
            ? (response.headers.get('content-type') || '')
            : '';
        if (contentType.toLowerCase().includes('application/json')) {
            const data = await response.json();
            return data.status === 'ok';
        }

        const text = await response.text();
        try {
            const data = JSON.parse(text);
            return data.status === 'ok';
        } catch (_) {
            return false;
        }
    } catch (error) {
        return false;
    }
}

/**
 * Load sandbox preview (Layer 3)
 * Only attempts if sandbox_allowed is true
 */
async function loadSandbox(url, sandboxAllowed) {
    // Only attempt sandbox if explicitly allowed
    if (!sandboxAllowed) {
        // Show sandbox panel with message instead of hiding it
        sandboxPanel.style.display = 'block';
        sandboxLoading.style.display = 'none';
        sandboxIframe.style.display = 'none';
        sandboxError.style.display = 'block';
        sandboxStatus.textContent = 'Status: Not Available';
        
        // Update error message
        const errorText = sandboxError.querySelector('p');
        if (errorText) {
            errorText.textContent = 'This website cannot be rendered in sandbox mode. Static preview is shown instead.';
        }
        return;
    }

    // Check backend health before attempting to load
    const backendOnline = await checkBackendHealth();
    if (!backendOnline) {
        sandboxPanel.style.display = 'block';
        sandboxLoading.style.display = 'none';
        sandboxIframe.style.display = 'none';
        sandboxError.style.display = 'block';
        sandboxStatus.textContent = 'Status: Error';
        
        const errorText = sandboxError.querySelector('p');
        if (errorText) {
            errorText.textContent = 'Safe Preview backend is not running.';
        }
        return;
    }

    // Show sandbox panel and attempt loading
    sandboxPanel.style.display = 'block';
    sandboxLoading.style.display = 'block';
    sandboxError.style.display = 'none';
    sandboxIframe.style.display = 'none';
    sandboxStatus.textContent = 'Status: Loading...';

    let loadTimeout;
    let errorDetected = false;
    
    // Create error state object to pass to handleSandboxError
    const errorState = { errorDetected, loadTimeout };

    // Use proxy endpoint to bypass X-Frame-Options
    const proxyUrl = `${API_BASE_URL}/proxy?url=${encodeURIComponent(url)}`;
    
    console.log('[Safe Preview] Loading sandbox with URL:', url);
    console.log('[Safe Preview] Proxy URL:', proxyUrl);
    
    try {
        // Double-check backend is still online before setting iframe src
        const backendStillOnline = await checkBackendHealth();
        if (!backendStillOnline) {
            handleSandboxError('Guardian scam service through gateway is not running.\n\nStart docker-compose so guardian-gateway listens on http://localhost:8090 (see Postman: GET /scam/health).', errorState);
            return;
        }
        
        // Test the proxy URL first to see if it's accessible and returns valid HTML
        try {
            console.log('[Safe Preview] Testing proxy URL accessibility...');
            const testResponse = await fetch(proxyUrl, { 
                method: 'GET', 
                mode: 'cors',
                headers: {
                    'Accept': 'text/html'
                }
            });
            console.log('[Safe Preview] Proxy URL test response status:', testResponse.status);
            console.log('[Safe Preview] Proxy URL test response headers:', Object.fromEntries(testResponse.headers.entries()));
            
            if (!testResponse.ok) {
                console.error('[Safe Preview] Proxy returned error status:', testResponse.status);
                const errorText = await testResponse.text();
                console.error('[Safe Preview] Proxy error response:', errorText.substring(0, 200));
                handleSandboxError('Proxy endpoint returned an error. The website may be blocking requests.', errorState);
                return;
            }
            
            // Check if response is actually HTML
            const contentType = testResponse.headers.get('content-type') || '';
            console.log('[Safe Preview] Proxy response content-type:', contentType);
            
            if (!contentType.includes('text/html')) {
                console.warn('[Safe Preview] Proxy response is not HTML, content-type:', contentType);
            }
            
            // Read a sample of the response to verify it's valid HTML
            const responseText = await testResponse.text();
            console.log('[Safe Preview] Proxy response preview (first 300 chars):', responseText.substring(0, 300));
            
            // Check for various error indicators
            const errorIndicators = [
                'Proxy Error',
                'Unable to Load Page',
                'Error. Page cannot be displayed',
                'Page cannot be displayed',
                'service provider',
                'An error occurred while fetching',
                '<h3>Error',
                'Error occurred',
                'Failed to fetch',
                'Connection refused',
                'refused to connect'
            ];
            
            const hasError = errorIndicators.some(indicator => 
                responseText.toLowerCase().includes(indicator.toLowerCase())
            );
            
            if (hasError) {
                console.error('[Safe Preview] Proxy returned an error page');
                console.error('[Safe Preview] Error page content:', responseText.substring(0, 500));
                handleSandboxError('The website could not be loaded. It may be blocking automated requests, temporarily unavailable, or require special access. The static preview above shows available metadata.', errorState);
                return;
            }
            
            if (responseText.length < 100) {
                console.warn('[Safe Preview] Proxy response is very short, might be an error');
                handleSandboxError('The website returned a very short response. It may be blocking automated requests.', errorState);
                return;
            }
            
            // Check if it's a valid HTML document (has <html> or <body> tags)
            const hasValidHTML = responseText.includes('<html') || 
                                 responseText.includes('<body') || 
                                 responseText.includes('<!DOCTYPE');
            
            if (!hasValidHTML && responseText.trim().length > 0) {
                console.warn('[Safe Preview] Response does not appear to be valid HTML');
                // Still try to load it - might be plain text or JSON
            }
            
            console.log('[Safe Preview] Proxy URL is accessible and returns valid HTML, loading in iframe');
        } catch (testError) {
            console.error('[Safe Preview] Proxy URL test failed:', testError);
            console.error('[Safe Preview] Error details:', testError.message);
            console.error('[Safe Preview] Error stack:', testError.stack);
            // If fetch fails, the proxy might not be accessible
            handleSandboxError('Unable to connect to proxy endpoint. Ensure guardian-gateway is running on http://localhost:8090.', errorState);
            return;
        }
        
        console.log('[Safe Preview] Setting iframe src to:', proxyUrl);
        // Set iframe src - this will trigger the load
        sandboxIframe.src = proxyUrl;

        // Handle successful load
        sandboxIframe.onload = () => {
            if (errorDetected) {
                console.log('[Safe Preview] onload fired but error already detected, ignoring');
                return;
            }
            
            console.log('[Safe Preview] Iframe onload event fired - content loaded');
            
            // Since onload fired, the iframe has loaded something
            // Try to check if it's an error page, but if we can't access it (cross-origin),
            // just show it anyway - the user will see what's there
            
            setTimeout(() => {
                try {
                    const iframeDoc = sandboxIframe.contentDocument || sandboxIframe.contentWindow?.document;
                    if (iframeDoc) {
                        // We CAN access the document - check for errors
                        const bodyText = iframeDoc.body ? iframeDoc.body.textContent || '' : '';
                        const title = iframeDoc.title || '';
                        
                        console.log('[Safe Preview] Iframe document accessible, title:', title);
                        console.log('[Safe Preview] Body text preview:', bodyText.substring(0, 200));
                        
                        // Check for connection errors
                        if (bodyText.includes('refused to connect') || 
                            (bodyText.includes('127.0.0.1') && bodyText.includes('refused')) ||
                            title.includes('refused') ||
                            bodyText.includes('ERR_CONNECTION_REFUSED') ||
                            bodyText.includes('Unable to connect') ||
                            bodyText.includes('This site can\'t be reached') ||
                            bodyText.includes('ERR_CONNECTION_REFUSED')) {
                            console.error('[Safe Preview] Connection refused error detected in iframe');
                            handleSandboxError('Guardian scam service through gateway is not running. Start docker-compose so http://localhost:8090/scam serves GET /proxy.', errorState);
                            return;
                        }
                        
                        // Check for proxy errors
                        if (bodyText.includes('Proxy Error') || 
                            bodyText.includes('Unable to Load Page') ||
                            bodyText.includes('An error occurred while fetching')) {
                            console.error('[Safe Preview] Proxy error detected in iframe');
                            handleSandboxError('Unable to fetch the website through the proxy. The site may be blocking automated requests or may be temporarily unavailable.', errorState);
                            return;
                        }
                        
                        // Check for other errors
                        if (bodyText.includes('Failed to fetch') || 
                            bodyText.includes('NetworkError') ||
                            bodyText.includes('getaddrinfo failed')) {
                            console.error('[Safe Preview] Network error detected in iframe');
                            handleSandboxError('Unable to connect to the website.', errorState);
                            return;
                        }
                        
                        // Success - page loaded and no errors found
                        console.log('[Safe Preview] Page loaded successfully, no errors detected');
                        clearTimeout(errorState.loadTimeout);
                        sandboxLoading.style.display = 'none';
                        sandboxIframe.style.display = 'block';
                        sandboxError.style.display = 'none';
                        sandboxStatus.textContent = 'Status: ✅ Loaded';
                        return;
                    }
                } catch (e) {
                    // Cross-origin - can't access iframe content
                    // This is normal for external sites - browser security prevents access
                    console.log('[Safe Preview] Cross-origin access blocked (normal for external sites):', e.message);
                    console.log('[Safe Preview] Since onload fired, showing iframe - user will see the content');
                }
                
                // If we get here, either:
                // 1. We can't access the document (cross-origin) - show it anyway
                // 2. We accessed it but found no errors - show it
                console.log('[Safe Preview] Displaying iframe content');
                clearTimeout(errorState.loadTimeout);
                sandboxLoading.style.display = 'none';
                sandboxIframe.style.display = 'block';
                sandboxError.style.display = 'none';
                sandboxStatus.textContent = 'Status: ✅ Loaded';
            }, 500); // Short delay to let content render
        };

        // Handle load errors
        sandboxIframe.onerror = () => {
            handleSandboxError('Failed to load page in sandbox', errorState);
        };

        // Check for X-Frame-Options/CSP blocking or connection errors
        // Use timeout to detect if page is blocked or failed
        errorState.loadTimeout = setTimeout(() => {
            if (!errorState.errorDetected) {
                console.log('[Safe Preview] Timeout reached, checking iframe status');
                // Check if iframe actually loaded
                try {
                    const iframeDoc = sandboxIframe.contentDocument || sandboxIframe.contentWindow?.document;
                    if (!iframeDoc) {
                        // Can't access - could be blocked by X-Frame-Options, CSP, or connection error
                        console.log('[Safe Preview] Cannot access iframe document - checking if iframe has src');
                        // Check if iframe still has the src (might have been cleared on error)
                        if (sandboxIframe.src && sandboxIframe.src.includes('proxy')) {
                            // Iframe has src but we can't access it - likely cross-origin (normal)
                            // But if it's been too long, might be an error
                            console.log('[Safe Preview] Iframe has src but document not accessible - assuming cross-origin (normal)');
                            // Show the iframe anyway - it might be loading
                            sandboxLoading.style.display = 'none';
                            sandboxIframe.style.display = 'block';
                            sandboxError.style.display = 'none';
                            sandboxStatus.textContent = 'Status: ✅ Loaded';
                        } else {
                            console.error('[Safe Preview] Iframe src missing or cleared');
                            handleSandboxError('Failed to load page. The site may block iframe embedding or the connection failed.', errorState);
                        }
                    } else {
                        // Document accessible, check for errors
                        const bodyText = iframeDoc.body ? iframeDoc.body.textContent || '' : '';
                        const title = iframeDoc.title || '';
                        
                        console.log('[Safe Preview] Iframe document accessible after timeout, checking for errors');
                        
                        // Check for proxy errors
                        if (bodyText.includes('Proxy Error') || 
                            bodyText.includes('Unable to Load Page') ||
                            bodyText.includes('An error occurred while fetching')) {
                            console.error('[Safe Preview] Proxy error detected in timeout check');
                            handleSandboxError('Unable to fetch the website through the proxy. The site may be blocking automated requests or may be temporarily unavailable.', errorState);
                            return;
                        }
                        
                        // Check for connection errors
                        if (bodyText.includes('refused to connect') || 
                            (bodyText.includes('127.0.0.1') && bodyText.includes('refused')) ||
                            title.includes('refused') ||
                            bodyText.includes('ERR_CONNECTION_REFUSED') ||
                            bodyText.includes('This site can\'t be reached')) {
                            console.error('[Safe Preview] Connection error detected in timeout check');
                            handleSandboxError('Guardian scam connection failed. Ensure gateway on http://localhost:8090 is running.', errorState);
                            return;
                        }
                        
                        if (bodyText.includes('X-Frame-Options') ||
                            bodyText.includes('blocked')) {
                            handleSandboxError('Site blocks iframe embedding', errorState);
                        } else {
                            // No errors found, show the iframe
                            sandboxLoading.style.display = 'none';
                            sandboxIframe.style.display = 'block';
                            sandboxError.style.display = 'none';
                            sandboxStatus.textContent = 'Status: ✅ Loaded';
                        }
                    }
                } catch (e) {
                    // Cross-origin error - might be normal or might be an error
                    console.log('[Safe Preview] Exception accessing iframe:', e.message);
                    // If we can't access due to cross-origin, assume it loaded (normal for external sites)
                    if (sandboxIframe.src && sandboxIframe.src.includes('proxy')) {
                        sandboxLoading.style.display = 'none';
                        sandboxIframe.style.display = 'block';
                        sandboxError.style.display = 'none';
                        sandboxStatus.textContent = 'Status: ✅ Loaded';
                    } else {
                        handleSandboxError('Failed to load page. The site may block iframe embedding.', errorState);
                    }
                }
            }
        }, 8000); // 8 second timeout - longer to allow slow sites to load
        loadTimeout = errorState.loadTimeout; // Keep reference for compatibility

    } catch (error) {
        console.error('[Safe Preview] Sandbox load error:', error);
        handleSandboxError('Failed to initialize sandbox', errorState);
    }
}

/**
 * Handle sandbox loading errors gracefully
 */
function handleSandboxError(reason, errorState = {}) {
    // errorState should contain { errorDetected, loadTimeout }
    if (errorState.errorDetected) return;
    
    errorState.errorDetected = true;
    if (errorState.loadTimeout) {
        clearTimeout(errorState.loadTimeout);
    }
    sandboxLoading.style.display = 'none';
    sandboxIframe.style.display = 'none';
    sandboxError.style.display = 'block';
    sandboxStatus.textContent = 'Status: Error';
    
    // Update error message with friendly text
    const errorText = sandboxError.querySelector('p');
    if (errorText) {
        // Map technical errors to friendly messages
        let friendlyMessage = reason || 'Failed to load page in sandbox';
        const msgLower = friendlyMessage.toLowerCase();
        
        if (msgLower.includes('refused to connect') || 
            msgLower.includes('127.0.0.1') || 
            msgLower.includes('backend server') ||
            msgLower.includes('connection refused') ||
            msgLower.includes('can\'t be reached')) {
            friendlyMessage = 'Guardian scam service through gateway is not running.\n\nStart docker-compose so guardian-gateway listens on http://localhost:8090.';
        } else if (msgLower.includes('failed to fetch') || 
                   msgLower.includes('networkerror') ||
                   msgLower.includes('unable to connect')) {
            friendlyMessage = 'Unable to connect to the website.';
        } else if (msgLower.includes('getaddrinfo')) {
            friendlyMessage = 'Unable to resolve domain name.';
        } else if (msgLower.includes('timeout')) {
            friendlyMessage = 'The website took too long to respond.';
        } else if (msgLower.includes('blocks') || 
                   msgLower.includes('x-frame-options') ||
                   msgLower.includes('csp')) {
            friendlyMessage = 'This site blocks sandbox preview. Static preview is shown instead.';
        }
        
        errorText.textContent = friendlyMessage;
    }
    
    console.log('[Safe Preview] Sandbox error:', reason);
}

/**
 * Get scan data from storage
 */
async function getScanData(scanId) {
    if (!scanId) return null;
    
    try {
        const result = await chrome.storage.local.get([scanId]);
        const data = result[scanId] || null;
        
        // Clean up storage after retrieving
        if (data) {
            chrome.storage.local.remove([scanId]);
        }
        
        return data;
    } catch (error) {
        console.error('[Safe Preview] Error getting scan data:', error);
        return null;
    }
}

/**
 * Display detailed log
 */
function displayDetailedLog(scanData) {
    if (!detailedLogPanel || !scanData) return;
    
    // Show the panel
    detailedLogPanel.style.display = 'block';
    
    // Set verdict and risk score
    const riskScore = scanData.risk_score || 0;
    const riskColor = riskScore >= 80 ? '#e74c3c' : riskScore >= 30 ? '#f39c12' : '#2ecc71';
    const verdictText = riskScore >= 80 ? 'DANGEROUS' : riskScore >= 30 ? 'SUSPICIOUS' : 'SAFE';
    
    const verdictEl = document.getElementById('log-verdict');
    const riskScoreEl = document.getElementById('log-risk-score');
    const confidenceEl = document.getElementById('log-confidence');
    const urlEl = document.getElementById('log-url');
    const explanationEl = document.getElementById('log-explanation');
    const sourceEl = document.getElementById('log-source');
    const urlAnalysisEl = document.getElementById('log-url-analysis');
    const urlAnalysisDetailsEl = document.getElementById('log-url-analysis-details');
    const aiAnalysisEl = document.getElementById('log-ai-analysis');
    const aiAnalysisDetailsEl = document.getElementById('log-ai-analysis-details');
    
    if (verdictEl) {
        verdictEl.textContent = verdictText;
        verdictEl.style.color = riskColor;
    }
    
    if (riskScoreEl) {
        riskScoreEl.textContent = riskScore.toFixed(1);
    }
    
    // Set confidence
    const confidence = (scanData.confidence || 0) * 100;
    if (confidenceEl) {
        confidenceEl.textContent = confidence.toFixed(1);
    }
    
    // Set URL
    if (urlEl) {
        urlEl.textContent = scanData.url || targetUrl || '-';
    }
    
    // Set explanation
    if (explanationEl) {
        explanationEl.textContent = scanData.explanation || 'No explanation available';
    }
    
    // Set source
    if (sourceEl) {
        sourceEl.textContent = (scanData.source || 'HYBRID').toUpperCase();
    }
    
    // URL Analysis
    if (scanData.url_result && urlAnalysisEl && urlAnalysisDetailsEl) {
        urlAnalysisEl.style.display = 'block';
        urlAnalysisDetailsEl.textContent = `Status: ${scanData.url_result.status || 'unknown'}, Score: ${scanData.url_result.risk_score || 0}`;
    } else if (urlAnalysisEl) {
        urlAnalysisEl.style.display = 'none';
    }
    
    // AI Analysis
    if (scanData.text_result && aiAnalysisEl && aiAnalysisDetailsEl) {
        aiAnalysisEl.style.display = 'block';
        const aiScore = scanData.text_result.risk_score || 0;
        const aiConfidence = (scanData.text_result.confidence || 0) * 100;
        aiAnalysisDetailsEl.textContent = `Score: ${aiScore.toFixed(2)}%, Confidence: ${aiConfidence.toFixed(1)}%`;
    } else if (aiAnalysisEl) {
        aiAnalysisEl.style.display = 'none';
    }
}

/**
 * Initialize preview
 */
async function initializePreview() {
    console.log('[Safe Preview] ===== INITIALIZING PREVIEW =====');
    console.log('[Safe Preview] Target URL:', targetUrl);
    console.log('[Safe Preview] Risk Score:', riskScore);
    console.log('[Safe Preview] Status:', status);
    console.log('[Safe Preview] Scan ID:', scanId);
    
    if (!targetUrl) {
        console.error('[Safe Preview] No URL provided!');
        showError('No URL provided');
        return;
    }

    // Get scan data from storage if available
    let scanData = null;
    if (scanId) {
        console.log('[Safe Preview] Fetching scan data for ID:', scanId);
        scanData = await getScanData(scanId);
        if (scanData) {
            console.log('[Safe Preview] Scan data retrieved:', scanData);
        } else {
            console.warn('[Safe Preview] No scan data found for ID:', scanId);
        }
    }

    try {
        // Always show detailed log if we have scan data
        if (scanData) {
            console.log('[Safe Preview] Displaying detailed log');
            displayDetailedLog(scanData);
        }
        
        // Fetch metadata (Layer 1)
        console.log('[Safe Preview] Fetching metadata for URL:', targetUrl);
        const metadata = await fetchMetadata(targetUrl);
        console.log('[Safe Preview] Metadata response:', metadata);
        
        // Check if response contains an error
        if (metadata.error_type) {
            console.error('[Safe Preview] Metadata fetch returned error:', metadata.error_type, metadata.message);
            // If we have scan data, show it instead of error
            if (scanData) {
                console.log('[Safe Preview] Showing scan data instead of error');
                loadingState.style.display = 'none';
                previewContent.style.display = 'block';
                // Detailed log is already shown above
                return;
            }
            showError(metadata);
            return;
        }
        
        // Display metadata (Layer 1)
        console.log('[Safe Preview] Displaying metadata');
        displayMetadata(metadata);
        
        // Display static preview (Layer 2)
        console.log('[Safe Preview] Displaying static preview');
        displayStaticPreview(metadata);
        
        // Show Cloudflare warning if protected
        if (metadata.cloudflare_protected === true) {
            console.log('[Safe Preview] Cloudflare protection detected');
            cloudflareWarning.style.display = 'block';
        } else {
            cloudflareWarning.style.display = 'none';
        }
        
        // Show preview content
        console.log('[Safe Preview] Showing preview content');
        loadingState.style.display = 'none';
        previewContent.style.display = 'block';
        
        // Load sandbox (Layer 3) if allowed
        const normalizedUrl = normalizeUrl(targetUrl);
        console.log('[Safe Preview] Sandbox allowed:', metadata.sandbox_allowed);
        console.log('[Safe Preview] Loading sandbox for normalized URL:', normalizedUrl);
        loadSandbox(normalizedUrl, metadata.sandbox_allowed);
        
    } catch (error) {
        console.error('[Safe Preview] ===== ERROR IN INITIALIZE PREVIEW =====');
        console.error('[Safe Preview] Error type:', error.name);
        console.error('[Safe Preview] Error message:', error.message);
        console.error('[Safe Preview] Error stack:', error.stack);
        
        // If we have scan data, show it instead of error
        if (scanData) {
            console.log('[Safe Preview] Showing scan data instead of error');
            loadingState.style.display = 'none';
            previewContent.style.display = 'block';
            // Detailed log is already shown above
            return;
        }
        
        showError({
            error_type: "network_error",
            message: error.message || 'Failed to load preview'
        });
    }
}

/**
 * Show error state with structured error
 */
function showError(errorData) {
    loadingState.style.display = 'none';
    errorState.style.display = 'block';
    previewContent.style.display = 'none';
    
    // Handle structured error or plain string
    if (typeof errorData === 'object' && errorData.error_type) {
        // Map error messages to friendly text
        let friendlyMessage = errorData.message || 'Unknown error occurred';
        
        // Additional mapping for common technical error messages
        const errorLower = friendlyMessage.toLowerCase();
        if (errorLower.includes('getaddrinfo') || errorLower.includes('name resolution')) {
            friendlyMessage = "Unable to resolve domain name.";
        } else if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
            friendlyMessage = "The website took too long to respond.";
        } else if (errorLower.includes('status: 500') || errorLower.includes('server error')) {
            friendlyMessage = "The website blocked automated preview requests.";
        } else if (errorLower.includes('status:') && errorLower.includes('500')) {
            friendlyMessage = "The website blocked automated preview requests.";
        }
        
        // Don't show error title, just show the friendly message
        errorMessage.textContent = friendlyMessage;
    } else {
        // Fallback for plain string errors - also map to friendly messages
        let errorText = typeof errorData === 'string' ? errorData : 'Unknown error occurred';
        const errorLower = errorText.toLowerCase();
        
        if (errorLower.includes('getaddrinfo') || errorLower.includes('name resolution')) {
            errorText = "Unable to resolve domain name.";
        } else if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
            errorText = "The website took too long to respond.";
        } else if (errorLower.includes('status: 500') || errorLower.includes('server error')) {
            errorText = "The website blocked automated preview requests.";
        }
        
        errorMessage.textContent = errorText;
    }
}

/**
 * Close preview window
 */
function closePreview() {
    window.close();
}

/**
 * Show warning dialog before opening link
 */
function showWarningDialog() {
    warningDialog.style.display = 'flex';
}

/**
 * Hide warning dialog
 */
function hideWarningDialog() {
    warningDialog.style.display = 'none';
}

/**
 * Open URL in new tab (after warning confirmation)
 */
function openAnyway() {
    const normalizedUrl = normalizeUrl(targetUrl);
    if (normalizedUrl) {
        chrome.tabs.create({ url: normalizedUrl });
        window.close();
    }
}

// Event listeners
closeBtn.addEventListener('click', closePreview);
cancelBtn.addEventListener('click', closePreview);
openAnywayBtn.addEventListener('click', showWarningDialog);
warningCancelBtn.addEventListener('click', hideWarningDialog);
warningConfirmBtn.addEventListener('click', () => {
    hideWarningDialog();
    openAnyway();
});
retryBtn.addEventListener('click', () => {
    errorState.style.display = 'none';
    loadingState.style.display = 'block';
    initializePreview();
});

// Close warning dialog when clicking outside
warningDialog.addEventListener('click', (e) => {
    if (e.target === warningDialog) {
        hideWarningDialog();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePreview();
    }
});

// Initialize when page loads
console.log('[Safe Preview] ===== SCRIPT LOADED =====');
console.log('[Safe Preview] Document ready state:', document.readyState);
console.log('[Safe Preview] API Base URL:', API_BASE_URL);
console.log('[Safe Preview] Target URL from params:', targetUrl);
console.log('[Safe Preview] Risk Score from params:', riskScore);
console.log('[Safe Preview] Status from params:', status);
console.log('[Safe Preview] Scan ID from params:', scanId);

// Also log to window for debugging
window.safePreviewDebug = {
    apiBaseUrl: API_BASE_URL,
    targetUrl: targetUrl,
    riskScore: riskScore,
    status: status,
    scanId: scanId
};
console.log('[Safe Preview] Debug info available at window.safePreviewDebug');

// Add a visible debug message if console is open
if (targetUrl) {
    console.log('%c[Safe Preview] Script is running! Check this console for details.', 'color: green; font-weight: bold; font-size: 14px;');
} else {
    console.error('%c[Safe Preview] ERROR: No target URL found in query parameters!', 'color: red; font-weight: bold; font-size: 14px;');
    console.log('[Safe Preview] Query string:', window.location.search);
    console.log('[Safe Preview] Full URL:', window.location.href);
}

if (document.readyState === 'loading') {
    console.log('[Safe Preview] Waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[Safe Preview] DOMContentLoaded fired, initializing preview');
        initializePreview();
    });
} else {
    console.log('[Safe Preview] DOM already loaded, initializing preview immediately');
    initializePreview();
}
