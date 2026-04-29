#!/usr/bin/env bun
import { Command } from 'commander';
import { login } from './auth.js';

const program = new Command();

program
    .name('betterproposals')
    .description('Official CLI for Better Proposals')
    .version('0.0.1');

program
    .command('login')
    .description('Authenticate the CLI with your Better Proposals account')
    .action(async () => {
        try {
            await login();
        } catch (err) {
            console.error('Login failed:', err.message);
            process.exit(1);
        }
    });

await program.parseAsync(process.argv);