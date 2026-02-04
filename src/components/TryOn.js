import React, { useEffect, useState, useCallback, useRef } from 'react';
import '../style/TryOn.style.css';

import {
    initializeFaceLandmarker,
    initializeScene,
    startTracking,
    stopTracking,
    cleanup
} from './render.js';

// Loading states
const LoadingState = {
    IDLE: 'idle',
    REQUESTING_CAMERA: 'requesting_camera',
    LOADING_AI: 'loading_ai',
    LOADING_MODEL: 'loading_model',
    READY: 'ready',
    ERROR: 'error'
};

export const TryOn = () => {
    const [loadingState, setLoadingState] = useState(LoadingState.IDLE);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [error, setError] = useState(null);
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const isInitializedRef = useRef(false);

    const handleProgress = useCallback((message) => {
        setLoadingMessage(message);
    }, []);

    const initializeApp = useCallback(async () => {
        if (isInitializedRef.current) return;
        isInitializedRef.current = true;

        const video = videoRef.current;
        if (!video) {
            setError('Video element not found');
            setLoadingState(LoadingState.ERROR);
            return;
        }

        try {
            // Step 1: Request camera access
            setLoadingState(LoadingState.REQUESTING_CAMERA);
            setLoadingMessage('Requesting camera access...');

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                }
            });

            streamRef.current = stream;
            video.srcObject = stream;

            // Wait for video to be ready
            await new Promise((resolve, reject) => {
                video.onloadedmetadata = () => {
                    video.play()
                        .then(resolve)
                        .catch(reject);
                };
                video.onerror = reject;
            });

            // Step 2: Initialize MediaPipe Face Landmarker
            setLoadingState(LoadingState.LOADING_AI);
            const aiSuccess = await initializeFaceLandmarker(handleProgress);
            if (!aiSuccess) {
                throw new Error('Failed to load AI model');
            }

            // Step 3: Initialize Three.js scene and load 3D model
            setLoadingState(LoadingState.LOADING_MODEL);
            await initializeScene('purple1', handleProgress);

            // Step 4: Start face tracking
            setLoadingState(LoadingState.READY);
            setLoadingMessage('');
            startTracking();

        } catch (err) {
            console.error('Initialization error:', err);
            setError(err.message || 'Failed to initialize');
            setLoadingState(LoadingState.ERROR);
        }
    }, [handleProgress]);

    useEffect(() => {
        initializeApp();

        return () => {
            // Cleanup on unmount
            stopTracking();
            cleanup();

            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }

            isInitializedRef.current = false;
        };
    }, [initializeApp]);

    const getLoadingText = () => {
        switch (loadingState) {
            case LoadingState.REQUESTING_CAMERA:
                return 'Requesting camera access...';
            case LoadingState.LOADING_AI:
                return loadingMessage || 'Loading AI model...';
            case LoadingState.LOADING_MODEL:
                return loadingMessage || 'Loading 3D glasses...';
            default:
                return loadingMessage || 'Loading...';
        }
    };

    const isLoading = loadingState !== LoadingState.READY && loadingState !== LoadingState.ERROR;

    return (
        <div className="tryon-container">
            {/* Loading Overlay */}
            {isLoading && (
                <div className="loading-overlay">
                    <div className="loading-content">
                        <div className="loading-spinner"></div>
                        <p className="loading-text">{getLoadingText()}</p>
                    </div>
                </div>
            )}

            {/* Error Display */}
            {loadingState === LoadingState.ERROR && (
                <div className="error-overlay">
                    <div className="error-content">
                        <div className="error-icon">⚠️</div>
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

            {/* Main Content */}
            <div id="threejsContainer" className={isLoading ? 'hidden' : ''}>
                <video
                    id="tryon-video"
                    ref={videoRef}
                    playsInline
                    muted
                />
            </div>

            {/* Instructions */}
            {loadingState === LoadingState.READY && (
                <div className="instructions">
                    <p>Position your face in the frame to try on glasses</p>
                </div>
            )}
        </div>
    );
};
