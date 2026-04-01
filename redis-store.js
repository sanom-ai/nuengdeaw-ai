'use strict';

const net = require('net');

function encodeCommand(parts) {
  let payload = `*${parts.length}\r\n`;
  for (const part of parts) {
    const value = String(part);
    payload += `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }
  return payload;
}

function parseSimpleReply(buffer) {
  const type = String.fromCharCode(buffer[0]);
  const end = buffer.indexOf('\r\n');
  if (end === -1) {
    return null;
  }

  if (type === '+' || type === '-' || type === ':') {
    return {
      consumed: end + 2,
      value: buffer.slice(1, end).toString('utf8'),
      type,
    };
  }

  if (type === '$') {
    const size = Number(buffer.slice(1, end).toString('utf8'));
    if (size === -1) {
      return { consumed: end + 2, value: null, type };
    }
    const total = end + 2 + size + 2;
    if (buffer.length < total) {
      return null;
    }
    return {
      consumed: total,
      value: buffer.slice(end + 2, end + 2 + size).toString('utf8'),
      type,
    };
  }

  return null;
}

class RedisStore {
  constructor(redisUrl) {
    this.redisUrl = new URL(redisUrl);
  }

  async command(parts) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.redisUrl.hostname,
        port: Number(this.redisUrl.port || 6379),
      });

      let buffer = Buffer.alloc(0);
      let stage = 0;
      const queue = [];
      const commands = [];

      if (this.redisUrl.password) {
        commands.push(['AUTH', this.redisUrl.password]);
      }
      if (this.redisUrl.pathname && this.redisUrl.pathname !== '/') {
        commands.push(['SELECT', this.redisUrl.pathname.slice(1)]);
      }
      commands.push(parts);

      socket.on('connect', () => {
        for (const command of commands) {
          queue.push(command[0]);
          socket.write(encodeCommand(command));
        }
      });

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length > 0) {
          const parsed = parseSimpleReply(buffer);
          if (!parsed) {
            return;
          }
          buffer = buffer.slice(parsed.consumed);
          const commandName = queue[stage];
          stage += 1;

          if (parsed.type === '-') {
            socket.destroy();
            reject(new Error(`Redis ${commandName} failed: ${parsed.value}`));
            return;
          }

          if (stage === commands.length) {
            socket.end();
            resolve(parsed.value);
            return;
          }
        }
      });

      socket.on('error', reject);
    });
  }

  async get(key) {
    return this.command(['GET', key]);
  }

  async set(key, value) {
    return this.command(['SET', key, value]);
  }

  async del(key) {
    return this.command(['DEL', key]);
  }

  async ping() {
    return this.command(['PING']);
  }
}

module.exports = { RedisStore };
