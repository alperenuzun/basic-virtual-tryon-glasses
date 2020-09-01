import React from 'react';
import { useEffect } from 'react';
import '../style/FaceFilter.style.css';

import {
    IntializeEngine, IntializeThreejs
} from './render.js';


export const FaceFilter = () => {

    var video;

    useEffect(() => {

        async function init() {
            video = document.getElementById('facemesh-video');

            await navigator.mediaDevices.getUserMedia({
                'audio': false,
                'video': {
                    facingMode: 'user',
                }
            }).then(stream => {
                video.srcObject = stream;
            });

            video.oncanplay = (e) => {
                video.play();
                IntializeThreejs("purple1");
                IntializeEngine();
            }
        }

        init();

        return () => {

        };
    }, []);

    return (
        <div className="row arcomp">
            <div id="threejsContainer">
                <video id="facemesh-video"></video>
            </div>
        </div>

    )
}