module.exports = {

  identity: '01bad2e8d4cf6c3db4dcc986ea4b2f03195b21afa3f7803d70bee070086d5d3c', // leave emtpy to generate new random identity
  foxtrot: {
    discovery: {
      connect: [],
      tcpserver: {
        port: 9333,
        seek: false,
      },
      file: {},
      dnsseed: {},
      zeroconf: {
        discover: true,
        advertise: true,
      },
      rumor: {},
      reconnect: {},
    }
  }

};
