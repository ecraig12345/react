/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// Don't wait before processing work on the server.
// TODO: we can replace this with FlightServer.act().
global.setImmediate = cb => cb();

let clientExports;
let turbopackMap;
let turbopackModules;
let turbopackModuleLoading;
let React;
let ReactDOMServer;
let ReactServerDOMServer;
let ReactServerDOMClient;
let Stream;
let use;

describe('ReactFlightDOMNode', () => {
  beforeEach(() => {
    jest.resetModules();

    // Simulate the condition resolution
    jest.mock('react', () => require('react/react.shared-subset'));
    jest.mock('react-server-dom-turbopack/server', () =>
      require('react-server-dom-turbopack/server.node'),
    );
    ReactServerDOMServer = require('react-server-dom-turbopack/server');

    const TurbopackMock = require('./utils/TurbopackMock');
    clientExports = TurbopackMock.clientExports;
    turbopackMap = TurbopackMock.turbopackMap;
    turbopackModules = TurbopackMock.turbopackModules;
    turbopackModuleLoading = TurbopackMock.moduleLoading;

    jest.resetModules();
    jest.unmock('react');
    jest.unmock('react-server-dom-turbopack/server');
    jest.mock('react-server-dom-turbopack/client', () =>
      require('react-server-dom-turbopack/client.node'),
    );

    React = require('react');
    ReactDOMServer = require('react-dom/server.node');
    ReactServerDOMClient = require('react-server-dom-turbopack/client');
    Stream = require('stream');
    use = React.use;
  });

  function readResult(stream) {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const writable = new Stream.PassThrough();
      writable.setEncoding('utf8');
      writable.on('data', chunk => {
        buffer += chunk;
      });
      writable.on('error', error => {
        reject(error);
      });
      writable.on('end', () => {
        resolve(buffer);
      });
      stream.pipe(writable);
    });
  }

  it('should allow an alternative module mapping to be used for SSR', async () => {
    function ClientComponent() {
      return <span>Client Component</span>;
    }
    // The Client build may not have the same IDs as the Server bundles for the same
    // component.
    const ClientComponentOnTheClient = clientExports(
      ClientComponent,
      'path/to/chunk.js',
    );
    const ClientComponentOnTheServer = clientExports(ClientComponent);

    // In the SSR bundle this module won't exist. We simulate this by deleting it.
    const clientId = turbopackMap[ClientComponentOnTheClient.$$id].id;
    delete turbopackModules[clientId];

    // Instead, we have to provide a translation from the client meta data to the SSR
    // meta data.
    const ssrMetadata = turbopackMap[ClientComponentOnTheServer.$$id];
    const translationMap = {
      [clientId]: {
        '*': ssrMetadata,
      },
    };

    function App() {
      return <ClientComponentOnTheClient />;
    }

    const stream = ReactServerDOMServer.renderToPipeableStream(
      <App />,
      turbopackMap,
    );
    const readable = new Stream.PassThrough();

    stream.pipe(readable);

    let response;
    function ClientRoot() {
      if (!response) {
        response = ReactServerDOMClient.createFromNodeStream(readable, {
          moduleMap: translationMap,
          moduleLoading: turbopackModuleLoading,
        });
      }
      return use(response);
    }

    const ssrStream = await ReactDOMServer.renderToPipeableStream(
      <ClientRoot />,
    );
    const result = await readResult(ssrStream);
    expect(result).toEqual(
      '<script src="/prefix/path/to/chunk.js" async=""></script><span>Client Component</span>',
    );
  });

  it('should encode long string in a compact format', async () => {
    const testString = '"\n\t'.repeat(500) + '🙃';

    const stream = ReactServerDOMServer.renderToPipeableStream({
      text: testString,
    });

    const readable = new Stream.PassThrough();

    const stringResult = readResult(readable);
    const parsedResult = ReactServerDOMClient.createFromNodeStream(readable, {
      moduleMap: turbopackMap,
      moduleLoading: turbopackModuleLoading,
    });

    stream.pipe(readable);

    const serializedContent = await stringResult;
    // The content should be compact an unescaped
    expect(serializedContent.length).toBeLessThan(2000);
    expect(serializedContent).not.toContain('\\n');
    expect(serializedContent).not.toContain('\\t');
    expect(serializedContent).not.toContain('\\"');
    expect(serializedContent).toContain('\t');

    const result = await parsedResult;
    // Should still match the result when parsed
    expect(result.text).toBe(testString);
  });

  // @gate enableBinaryFlight
  it('should be able to serialize any kind of typed array', async () => {
    const buffer = new Uint8Array([
      123, 4, 10, 5, 100, 255, 244, 45, 56, 67, 43, 124, 67, 89, 100, 20,
    ]).buffer;
    const buffers = [
      buffer,
      new Int8Array(buffer, 1),
      new Uint8Array(buffer, 2),
      new Uint8ClampedArray(buffer, 2),
      new Int16Array(buffer, 2),
      new Uint16Array(buffer, 2),
      new Int32Array(buffer, 4),
      new Uint32Array(buffer, 4),
      new Float32Array(buffer, 4),
      new Float64Array(buffer, 0),
      new BigInt64Array(buffer, 0),
      new BigUint64Array(buffer, 0),
      new DataView(buffer, 3),
    ];
    const stream = ReactServerDOMServer.renderToPipeableStream(buffers);
    const readable = new Stream.PassThrough();
    const promise = ReactServerDOMClient.createFromNodeStream(readable, {
      moduleMap: turbopackMap,
      moduleLoading: turbopackModuleLoading,
    });
    stream.pipe(readable);
    const result = await promise;
    expect(result).toEqual(buffers);
  });

  it('should allow accept a nonce option for Flight preinitialized scripts', async () => {
    function ClientComponent() {
      return <span>Client Component</span>;
    }
    // The Client build may not have the same IDs as the Server bundles for the same
    // component.
    const ClientComponentOnTheClient = clientExports(
      ClientComponent,
      'path/to/chunk.js',
    );
    const ClientComponentOnTheServer = clientExports(ClientComponent);

    // In the SSR bundle this module won't exist. We simulate this by deleting it.
    const clientId = turbopackMap[ClientComponentOnTheClient.$$id].id;
    delete turbopackModules[clientId];

    // Instead, we have to provide a translation from the client meta data to the SSR
    // meta data.
    const ssrMetadata = turbopackMap[ClientComponentOnTheServer.$$id];
    const translationMap = {
      [clientId]: {
        '*': ssrMetadata,
      },
    };
    const ssrManifest = {
      moduleMap: translationMap,
      moduleLoading: turbopackModuleLoading,
    };

    function App() {
      return <ClientComponentOnTheClient />;
    }

    const stream = ReactServerDOMServer.renderToPipeableStream(
      <App />,
      turbopackMap,
    );
    const readable = new Stream.PassThrough();
    let response;

    stream.pipe(readable);

    function ClientRoot() {
      if (response) return use(response);
      response = ReactServerDOMClient.createFromNodeStream(
        readable,
        ssrManifest,
        {
          nonce: 'r4nd0m',
        },
      );
      return use(response);
    }

    const ssrStream = await ReactDOMServer.renderToPipeableStream(
      <ClientRoot />,
    );
    const result = await readResult(ssrStream);
    expect(result).toEqual(
      '<script src="/prefix/path/to/chunk.js" async="" nonce="r4nd0m"></script><span>Client Component</span>',
    );
  });
});
