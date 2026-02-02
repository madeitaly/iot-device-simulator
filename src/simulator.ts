import express from 'express';
//import type { Request, Response } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// --- CONFIGURATION ---
const TARGET_API_URL = process.env.TARGET_API_URL || 'http://localhost:3000/api/telemetry';
//const UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 Minutes
const UPDATE_INTERVAL_MS = 2000; // 1 sec

// --- INTERFACES ---
// Matches your Postgres "Device" table columns
interface DeviceConfig {
    deviceId: number;
    serial: string;
    name: string;
    location: string;
}

// Matches the JSON payload you send to the backend
interface TelemetryPayload {
    deviceId: number;
    ts: string;
    temperature: number;
    humidity: number;
    battery: number;
    payload: {
        firmware: string;
        status: string;
        // We can include serial/location in the payload if your backend expects it
        // otherwise it stays internal to the simulator for logging
    };
}

// --- DEVICE CLASS ---
class SimulatedDevice {
    private config: DeviceConfig;
    private token: string;
    
    // Simulation State
    private baseTemp: number;
    private baseHum: number;
    private currentBattery: number;
    
    constructor(config: DeviceConfig, token: string) {
        this.config = config;
        this.token = token;
        
        // Randomize initial state slightly based on ID to avoid identical graphs
        const seed = config.deviceId; 
        this.baseTemp = 20 + (seed % 10); 
        this.baseHum = 40 + (seed % 15);  
        this.currentBattery = Math.floor(Math.random() * 100);
    }

    /**
     * generates the payload with realistic data fluctuation
     */
    public generateTelemetry(): TelemetryPayload {
        // Random Walk Logic
        const variance = () => 0.8 + (Math.random() * 0.4); 
        const temp = parseFloat((this.baseTemp * variance()).toFixed(1));
        const hum = parseFloat((this.baseHum * variance()).toFixed(1));
        const now = new Date();

        // Battery Logic (resets daily)
        this.currentBattery -= 0.35;
        if (this.currentBattery <= 0) this.currentBattery = 100;

        return {
            deviceId: this.config.deviceId,
            ts: now.toISOString(),
            temperature: temp,
            humidity: hum,
            battery: parseFloat(this.currentBattery.toFixed(1)),
            payload: { 
                firmware: "1.0.4", 
                status: "ok" 
            }
        };
    }

    /**
     * Sends the data to the main backend
     */
    public async pushData() {
        const data = this.generateTelemetry();
        
        try {
            await axios.post(TARGET_API_URL, data, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-device-token': this.token
                }
            });
            // Enhanced logging with Name and Location
            console.log(`[${this.config.name} @ ${this.config.location}]=${data.deviceId} Sent: T:${data.temperature} H:${data.humidity} B:${data.battery} at:${data.ts}`);
        } catch (error: any) {
            console.error(`[${this.config.name}]=${data.deviceId} Error:`, error.message);
        }
    }
}

// --- SERVER SETUP ---
// --- INITIALIZATION ---
const app = express();
const devices: SimulatedDevice[] = [];

// 1. Load the Registry
const configPath = path.join(process.cwd(), 'devices.json');
const rawConfig = fs.readFileSync(configPath, 'utf-8');
const deviceConfigs: DeviceConfig[] = JSON.parse(rawConfig);

console.log(`Loading ${deviceConfigs.length} devices from registry...`);

// 2. Instantiate Devices with Tokens from ENV
deviceConfigs.forEach(config => {
    // Dynamically look for the token in process.env using the ID
    const envTokenKey = `TOKEN_DEVICE_${config.deviceId}`;
    const token = process.env[envTokenKey];

    if (!token) {
        console.warn(`⚠️  Warning: No token found in .env for Device ID ${config.deviceId} (Expected key: ${envTokenKey}). Skipping.`);
        return;
    }

    devices.push(new SimulatedDevice(config, token));
});

console.log(`Successfully initialized ${devices.length} devices.`);

// --- SIMULATION LOOP ---
const startSimulation = () => {
    // Immediate first run
    devices.forEach(d => d.pushData());

    // Schedule
    setInterval(() => {
        devices.forEach(d => d.pushData());
    }, UPDATE_INTERVAL_MS);
};

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'running', activeDevices: devices.length });
});

app.listen(process.env.PORT || 4000, () => {
    console.log(`Simulator running on port ${process.env.PORT || 4000}`);
    startSimulation();
});