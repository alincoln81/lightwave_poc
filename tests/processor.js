// processor.js
module.exports = {
  beforeScenario: (context, events, done) => {
    const noop = () => {};
    // suppress any event that Artillery might use to abort a step
    ['error','disconnect','connect_error','connect_timeout','reconnect_error'].forEach(evt =>
      context.socket.on(evt, noop)
    );
    // stash the handler so we can remove it later
    context.vars._noop = noop;
    done();
  },

  afterScenario: (context, events, done) => {
    const noop = context.vars._noop;
    ['error','disconnect','connect_error','connect_timeout','reconnect_error'].forEach(evt =>
      context.socket.off(evt, noop)
    );
    done();
  }
};
