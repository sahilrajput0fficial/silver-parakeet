import React, { useState } from 'react';
import { Page, Card, Layout, FormLayout, TextField, Button, Text, Banner } from '@shopify/polaris';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await login(username, password);
      // Let App.jsx ProtectedRoute handle redirect if not admin/member
      if (data.user.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page>
      <Layout>
        <Layout.Section>
          <div style={{ maxWidth: '400px', margin: '40px auto' }}>
            <Card sectioned>
              <FormLayout>
                <Text variant="headingXl" as="h1">Sign in</Text>
                
                {error && <Banner status="critical">{error}</Banner>}

                <TextField
                  label="Username"
                  value={username}
                  onChange={setUsername}
                  autoComplete="username"
                />
                <TextField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                />
                
                <Button primary fullWidth loading={loading} onClick={handleLogin}>
                  Login
                </Button>
              </FormLayout>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
