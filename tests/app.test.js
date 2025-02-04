const nock = require('nock');
const fs = require('fs-extra');
const {
  login,
  getBearerToken,
  fetchAppointments,
  saveToken,
  loadToken,
  filterAppointmentsWithin2Weeks,
  server,
} = require('../bot');

jest.mock('fs-extra');

const TOKEN_FILE = './bearer_token.json';

beforeEach(() => {
  nock('https://onlinebusiness.icbc.com')
    .post('/deas-api/v1/web/login')
    .reply(200, { token: 'mockBearerToken' });

  nock('https://onlinebusiness.icbc.com')
    .post('/deas-api/v1/web/getAvailableAppointments')
    .reply(200, [
      {
        appointmentDt: { date: '2025-01-25', dayOfWeek: 'Monday' },
        startTm: '09:00',
        endTm: '09:30',
        posId: 153,
      },
      {
        appointmentDt: { date: '2025-01-15', dayOfWeek: 'Wednesday' },
        startTm: '14:00',
        endTm: '14:30',
        posId: 73,
      },
    ]);

  fs.readJson.mockReset();
  fs.writeJson.mockReset();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  if (server) {
    server.close();
  }
});

describe('ICBC API Program', () => {
  test('login should fetch and return a bearer token', async () => {
    fs.writeJson.mockResolvedValue();

    const token = await login();

    expect(token).toBe('mockBearerToken');
    expect(fs.writeJson).toHaveBeenCalledWith(TOKEN_FILE, { token: 'mockBearerToken' });
  });

  test('getBearerToken should load the token from file if available', async () => {
    fs.readJson.mockResolvedValue({ token: 'mockTokenFromFile' });

    const token = await getBearerToken();

    expect(token).toBe('mockTokenFromFile');
    expect(fs.readJson).toHaveBeenCalledWith(TOKEN_FILE);
  });

  test('getBearerToken should fetch a new token if none is available', async () => {
    fs.readJson.mockRejectedValue(new Error('File not found'));
    fs.writeJson.mockResolvedValue();

    const token = await getBearerToken();

    expect(token).toBe('mockBearerToken');
    expect(fs.writeJson).toHaveBeenCalledWith(TOKEN_FILE, { token: 'mockBearerToken' });
  });

  test('fetchAppointments should return appointments', async () => {
    fs.readJson.mockResolvedValue({ token: 'mockBearerToken' });

    const appointments = await fetchAppointments(153);

    expect(appointments).toEqual([
      {
        appointmentDt: { date: '2025-01-25', dayOfWeek: 'Monday' },
        startTm: '09:00',
        endTm: '09:30',
        posId: 153,
      },
      {
        appointmentDt: { date: '2025-01-15', dayOfWeek: 'Wednesday' },
        startTm: '14:00',
        endTm: '14:30',
        posId: 73,
      },
    ]);
    expect(fs.readJson).toHaveBeenCalledWith(TOKEN_FILE);
  });

  test('fetchAppointments should retry on 403 and fetch new token', async () => {
    fs.readJson.mockResolvedValue({ token: 'expiredToken' });

    nock('https://onlinebusiness.icbc.com')
      .post('/deas-api/v1/web/getAvailableAppointments')
      .reply(403)
      .post('/deas-api/v1/web/login')
      .reply(200, { token: 'newBearerToken' })
      .post('/deas-api/v1/web/getAvailableAppointments')
      .reply(200, [
        {
          appointmentDt: { date: '2025-01-25', dayOfWeek: 'Monday' },
          startTm: '09:00',
          endTm: '09:30',
          posId: 153,
        },
        {
          appointmentDt: { date: '2025-01-15', dayOfWeek: 'Wednesday' },
          startTm: '14:00',
          endTm: '14:30',
          posId: 73,
        },
      ]);

    fs.writeJson.mockResolvedValue();

    const appointments = await fetchAppointments(153);

    expect(appointments).toEqual([
      {
        appointmentDt: { date: '2025-01-25', dayOfWeek: 'Monday' },
        startTm: '09:00',
        endTm: '09:30',
        posId: 153,
      },
      {
        appointmentDt: { date: '2025-01-15', dayOfWeek: 'Wednesday' },
        startTm: '14:00',
        endTm: '14:30',
        posId: 73,
      },
    ]);
    expect(fs.writeJson).toHaveBeenCalledWith(TOKEN_FILE, { token: 'newBearerToken' });
  });

  test('filterAppointmentsWithin2Weeks should filter appointments correctly', () => {
    const mockAppointments = [
      { appointmentDt: { date: '2025-01-15' } },
      { appointmentDt: { date: '2025-02-05' } },
    ];

    const filteredAppointments = filterAppointmentsWithin2Weeks(mockAppointments);

    expect(filteredAppointments).toEqual([
      { appointmentDt: { date: '2025-01-15' } },
    ]);
  });
});