import React, { useState } from 'react';
import { Page, Layout, Card, FormLayout, TextField, Button, Text, Link, Banner, Box } from '@shopify/polaris';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(location.state?.error || null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(location.state?.message || null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await login(email, password);
      if (data.success) {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6f6f7' }}>
      <Page narrowWidth>
        <Layout>
          <Layout.Section>
            <Card sectioned>
              <Box padding="4" textAlign="center">
                <Text variant="headingLg" as="h1">Login</Text>
                <Text color="subdued">Access the Shopify Invoice Bulk Sender</Text>
              </Box>

              {success && (
                <Box paddingBlockEnd="4">
                  <Banner status="success">{success}</Banner>
                </Box>
              )}

              {error && (
                <Box paddingBlockEnd="4">
                  <Banner status="critical">{error}</Banner>
                </Box>
              )}

              <FormLayout>
                <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
                <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
                <Button primary fullWidth loading={loading} onClick={handleLogin}>Login</Button>
              </FormLayout>

              <Box paddingBlockStart="4" textAlign="center">
                <Text>Don't have an account? <Link onClick={() => navigate('/signup')}>Sign Up</Link></Text>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
