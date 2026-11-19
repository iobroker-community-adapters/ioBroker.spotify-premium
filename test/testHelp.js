// The answer of the message "help" (build/lib/help.js) must match what src/main.ts answers and listens to

const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');
const { COMMANDS, HELP } = require('../build/lib/help');

const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');

/** The commands onMessage of src/main.ts answers */
function commandsOfMain() {
    const start = source.indexOf('onMessage(obj: ioBroker.Message)');
    const end = source.indexOf('async request(');
    expect(start).to.be.greaterThan(0);
    expect(end).to.be.greaterThan(start);
    return [...source.slice(start, end).matchAll(/command === '([^']+)'/g)].map(m => m[1]);
}

/** The states the adapter acts on when they are written (this.cache.on('<id>', ...)) */
function listenedStates() {
    return [...source.matchAll(/this\.cache\.on\(\s*'([^']+)'/g)]
        .map(m => m[1])
        .filter(id => id !== 'authorization.oauth2Tokens'); // written by the settings only
}

describe('help', () => {
    it('lists exactly the commands onMessage answers', () => {
        expect(COMMANDS.map(c => c.command).sort()).to.deep.equal(commandsOfMain().sort());
        expect(COMMANDS).to.deep.include({ command: 'help', write: false });
        for (const c of COMMANDS) {
            expect(c.write).to.be.a('boolean');
        }
    });

    it('describes every state the adapter acts on', () => {
        const states = listenedStates();
        expect(states.length).to.be.greaterThan(20);
        for (const id of [...states, 'useForPlayback', 'playThisList', 'trackList']) {
            expect(HELP, id).to.include(id);
        }
    });

    it('tells how to talk to the user and keeps the lines short', () => {
        expect(HELP).to.include('sendTo spotify-premium.0');
        expect(HELP).to.include('How to talk to the user:');
        expect(HELP).to.include('ask which one');
        for (const line of HELP.split('\n')) {
            expect(line.length, line).to.be.at.most(120);
        }
    });
});
