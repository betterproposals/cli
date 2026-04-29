#!/usr/bin/env bun
import { Command } from 'commander';
import { login } from './auth.js';
import { documents } from './api.js';

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

const documentsCmd = program
    .command('documents')
    .description('Manage documents');

documentsCmd
    .command('list')
    .description('List documents')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .option('-t, --type <number>', 'Document type filter')
    .action(async (opts) => {
        try {
            const data = await documents.list({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
                type: opts.type !== undefined ? Number(opts.type) : undefined,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

await program.parseAsync(process.argv);