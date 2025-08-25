import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

export class Database {
    private db: sqlite3.Database;
    private dbPath: string;

    constructor(dbPath: string) {
        this.dbPath = dbPath;
        this.ensureDataDirectory();
        this.db = new sqlite3.Database(dbPath);
        this.init();
    }

    private ensureDataDirectory(): void {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private init(): void {
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        this.db.exec(schema, (err) => {
            if (err) {
                console.error('Error initializing database:', err);
            } else {
                console.log('Database initialized successfully');
            }
        });
    }

    // Simple query methods
    async get(query: string, params: any[] = []): Promise<any> {
        return new Promise((resolve, reject) => {
            this.db.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async all(query: string, params: any[] = []): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async run(query: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
        return new Promise((resolve, reject) => {
            this.db.run(query, params, function(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    close(): void {
        this.db.close();
    }
}

// Export a singleton instance
export const db = new Database(process.env.DATABASE_PATH || './data/dashboard.db');
