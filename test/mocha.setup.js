// Don't silently swallow unhandled rejections
process.on('unhandledRejection', (e) => {
    throw e;
});

// enable the should interface with sinon
// and load chai-as-promised and sinon-chai by default
const sinonChai = require('sinon-chai');
const { should, use } = require('chai');
const chaiAsPromised = require('chai-as-promised');

should();
if (typeof sinonChai === 'function') {
    use(sinonChai);
}
if (chaiAsPromised.default) {
    use(chaiAsPromised.default);
} else if (typeof chaiAsPromised === 'function') {
    use(chaiAsPromised);
}
