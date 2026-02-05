import React, { useEffect, useState, useCallback, useRef } from 'react';
import '../style/TryOn.style.css';

import { initialize, cleanup, resize } from './render.js';

// Loading states
const LoadingState = {
    IDLE: 'idle',
    INITIALIZING: 'initializing',
    READY: 'ready',
    ERROR: 'error'
};

export const TryOn = () => {
    const [loadingState, setLoadingState] = useState(LoadingState.IDLE);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [error, setError] = useState(null);
    const isInitializedRef = useRef(false);
    const canvasRef = useRef(null);

    const handleProgress = useCallback((message) => {
        setLoadingMessage(message);
    }, []);

    const initializeApp = useCallback(async () => {
        if (isInitializedRef.current) return;
        isInitializedRef.current = true;

        try {
            setLoadingState(LoadingState.INITIALIZING);
            setLoadingMessage('Starting...');

            // Initialize Jeeliz FaceFilter (handles webcam internally)
            await initialize('tryon-canvas', handleProgress);

            setLoadingState(LoadingState.READY);
            setLoadingMessage('');

        } catch (err) {
            console.error('Initialization error:', err);
            setError(err.message || 'Failed to initialize');
            setLoadingState(LoadingState.ERROR);
        }
    }, [handleProgress]);

    useEffect(() => {
        initializeApp();

        // Handle window resize
        const handleResize = () => {
            resize();
        };
        window.addEventListener('resize', handleResize);

        return () => {
            // Cleanup on unmount
            cleanup();
            window.removeEventListener('resize', handleResize);
            isInitializedRef.current = false;
        };
    }, [initializeApp]);

    const isLoading = loadingState === LoadingState.INITIALIZING || loadingState === LoadingState.IDLE;

    return (
        <div className="tryon-container">
            {/* Loading Overlay */}
            {isLoading && (
                <div className="loading-overlay">
                    <div className="loading-content">
                        <div className="loading-spinner"></div>
                        <p className="loading-text">{loadingMessage || 'Loading...'}</p>
                    </div>
                </div>
            )}

            {/* Error Display */}
            {loadingState === LoadingState.ERROR && (
                <div className="error-overlay">
                    <div className="error-content">
                        <div className="error-icon">!</div>
                        <h2>Something went wrong</h2>
                        <p>{error}</p>
                        <button
                            className="retry-button"
                            onClick={() => window.location.reload()}
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            )}

            {/* Canvas for Jeeliz FaceFilter */}
            <canvas
                id="tryon-canvas"
                ref={canvasRef}
                className={isLoading ? 'hidden' : ''}
            />

            {/* Instructions */}
            {loadingState === LoadingState.READY && (
                <div className="instructions">
                    <p>Position your face in the frame to try on glasses</p>
                </div>
            )}
        </div>
    );
};
