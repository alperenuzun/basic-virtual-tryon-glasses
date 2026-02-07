import React, { useEffect, useState, useRef, useCallback } from 'react';
import '../style/TryOn.style.css';
import { IntializeEngine, IntializeThreejs } from './render.js';

export const TryOn = () => {
    const [isLoading, setIsLoading] = useState(true);
    const [isRecording, setIsRecording] = useState(false);
    const recorderRef = useRef(null);
    const chunksRef = useRef([]);

    useEffect(() => {
        async function init() {
            var video = document.getElementById('tryon-video');

            await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: 'user' }
            }).then(stream => {
                video.srcObject = stream;
            });

            video.oncanplay = () => {
                video.play();
                IntializeThreejs("glasses_premium.gltf");
                IntializeEngine();
                setIsLoading(false);
            };
        }

        init();
        return () => {};
    }, []);

    const handleScreenshot = useCallback(() => {
        var canvas = document.querySelector('#threejsContainer canvas');
        if (!canvas) return;
        var link = document.createElement('a');
        link.download = 'virtual-tryon-' + Date.now() + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }, []);

    const handleRecord = useCallback(() => {
        if (isRecording) {
            if (recorderRef.current && recorderRef.current.state !== 'inactive') {
                recorderRef.current.stop();
            }
            setIsRecording(false);
            return;
        }

        var canvas = document.querySelector('#threejsContainer canvas');
        if (!canvas) return;

        chunksRef.current = [];
        var stream = canvas.captureStream(30);
        var mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';
        var recorder = new MediaRecorder(stream, { mimeType: mimeType });

        recorder.ondataavailable = function(e) {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = function() {
            var blob = new Blob(chunksRef.current, { type: 'video/webm' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.download = 'virtual-tryon-' + Date.now() + '.webm';
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
        };

        recorder.start();
        recorderRef.current = recorder;
        setIsRecording(true);
    }, [isRecording]);

    return (
        <div className="tryon-page">
            <div className="tryon-header">
                <h1 className="tryon-title">Virtual Try-On</h1>
                <p className="tryon-subtitle">AI-Powered Glasses Experience</p>
            </div>

            <div className="tryon-viewport">
                {isLoading && (
                    <div className="tryon-loading">
                        <div className="tryon-spinner"></div>
                        <p>Initializing camera...</p>
                    </div>
                )}
                <div id="threejsContainer">
                    <video id="tryon-video"></video>
                </div>
            </div>

            <div className="tryon-controls">
                <button className="tryon-btn" onClick={handleScreenshot} title="Take Screenshot">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                    </svg>
                    Screenshot
                </button>
                <button
                    className={'tryon-btn tryon-btn-record' + (isRecording ? ' recording' : '')}
                    onClick={handleRecord}
                    title={isRecording ? 'Stop Recording' : 'Start Recording'}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        {isRecording ? (
                            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
                        ) : (
                            <circle cx="12" cy="12" r="7" fill="currentColor"/>
                        )}
                    </svg>
                    {isRecording ? 'Stop' : 'Record'}
                </button>
            </div>

            <p className="tryon-footer">Powered by MediaPipe + Three.js</p>
        </div>
    );
};
