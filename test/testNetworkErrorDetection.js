// Simple unit test for transient error detection helpers
// These functions are extracted from main.js for testing

const { expect } = require('chai');

// Copy of the helper functions from main.js to test in isolation
function getErrorMessage(error) {
    if (!error) {
        return '';
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error.message) {
        return error.message;
    }
    return `${error}`;
}

function isTransientNetworkError(error) {
    if (!error) {
        return false;
    }

    const code = error.code || (error.cause && error.cause.code);
    const message = getErrorMessage(error).toUpperCase();
    const transientCodes = new Set([
        'EAI_AGAIN',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EHOSTUNREACH',
        'ENETUNREACH',
    ]);

    if (code && transientCodes.has(code)) {
        return true;
    }

    return (
        message.includes('EAI_AGAIN') ||
        message.includes('ECONNREFUSED') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('ENOTFOUND') ||
        message.includes('EHOSTUNREACH') ||
        message.includes('ENETUNREACH') ||
        message.includes('SOCKET HANG UP') ||
        message.includes('TIMEOUT')
    );
}

describe('Transient network error detection (isolated)', () => {
    it('detects code-based transient DNS errors (EAI_AGAIN)', () => {
        const err = new Error('getaddrinfo EAI_AGAIN accounts.spotify.com');
        err.code = 'EAI_AGAIN';

        expect(isTransientNetworkError(err)).to.equal(true);
    });

    it('detects message-based transient connection errors (ECONNREFUSED)', () => {
        const err = new Error('queryA ECONNREFUSED api.spotify.com');

        expect(isTransientNetworkError(err)).to.equal(true);
    });

    it('detects timeout errors (ETIMEDOUT)', () => {
        const err = new Error('Connection timeout');
        err.code = 'ETIMEDOUT';

        expect(isTransientNetworkError(err)).to.equal(true);
    });

    it('detects connection reset errors', () => {
        const err = new Error('socket hang up');

        expect(isTransientNetworkError(err)).to.equal(true);
    });

    it('detects ENOTFOUND DNS errors', () => {
        const err = new Error('getaddrinfo ENOTFOUND api.spotify.com');
        err.code = 'ENOTFOUND';

        expect(isTransientNetworkError(err)).to.equal(true);
    });

    it('does not classify auth failures as transient network errors', () => {
        const err = new Error('Request failed with status code 401');

        expect(isTransientNetworkError(err)).to.equal(false);
    });

    it('does not classify Spotify API errors as transient network errors', () => {
        const err = new Error('Bad Request');
        err.statusCode = 400;

        expect(isTransientNetworkError(err)).to.equal(false);
    });

    it('returns safe string message for string errors', () => {
        expect(getErrorMessage('simple error message')).to.equal('simple error message');
    });

    it('returns safe string message for Error objects', () => {
        const err = new Error('test error message');
        expect(getErrorMessage(err)).to.equal('test error message');
    });

    it('returns empty string for null/undefined errors', () => {
        expect(getErrorMessage(null)).to.equal('');
        expect(getErrorMessage(undefined)).to.equal('');
    });

    it('handles errors without message property', () => {
        const err = { code: 'ECONNREFUSED' };
        expect(isTransientNetworkError(err)).to.equal(true);
    });
});
