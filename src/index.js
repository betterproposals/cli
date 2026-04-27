#!/usr/bin/env node
import { Command } from 'commander';
const program = new Command();

program
    .name('betterproposals')
    .description('Official CLI for Better Proposals')
    .version('0.0.1');

program
    .command('login')
    .description('Authenticate the CLI with your Better Proposals account')
    .action(() => {
        console.log('Login command executed');
        // Auth logic here
    });

program.parse(process.argv);