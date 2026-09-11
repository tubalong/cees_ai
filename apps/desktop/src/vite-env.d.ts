/// <reference types="vite/client" />

interface Window {
    cees?: {
        platform: string;
        version: string;
        setZoomFactor: (factor: number) => void;
    };
}
