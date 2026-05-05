(() => {
    const GATEWAY_BASE_URL = 'https://surrender-slept-sculptor.ngrok-free.dev';

    const config = {
        GATEWAY_BASE_URL,
        MISINFORMATION_BASE_URL: GATEWAY_BASE_URL + '/misinformation',
        PII_OPSEC_BASE_URL: GATEWAY_BASE_URL + '/pii',
        HATESPEECH_BASE_URL: GATEWAY_BASE_URL + '/hatespeech',
        SCAM_BASE_URL: GATEWAY_BASE_URL + '/scam'
    };

    if (typeof globalThis !== 'undefined') {
        globalThis.GUARDIAN_CONFIG = Object.freeze(config);
    }
})();